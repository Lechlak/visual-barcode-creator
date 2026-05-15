require('dotenv').config();
const mysql = require('mysql2/promise');
const { Client } = require('ssh2');

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1', // localhost when tunneling
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

const sshConfig = {
    host: process.env.SSH_HOST || '35.236.219.140',
    port: parseInt(process.env.SSH_PORT, 10) || 52335,
    username: process.env.SSH_USER,
    password: process.env.SSH_PASSWORD,
    // Add privateKey: process.env.SSH_KEY if needed later
};

// Create an SSH tunnel Promise
function createTunnel(sshOptions, dbOptions) {
    return new Promise((resolve, reject) => {
        const sshClient = new Client();
        
        sshClient.on('ready', () => {
            sshClient.forwardOut(
                '127.0.0.1', // source IP
                12345,       // source Port (arbitrary, not really used here)
                dbOptions.host, // Destination Host (from perspective of SSH server)
                dbOptions.port, // Destination Port
                async (err, stream) => {
                    if (err) {
                        sshClient.end();
                        return reject(err);
                    }

                    try {
                        // Pass the forwarded SSH stream into the MySQL connection
                        const connection = await mysql.createConnection({
                            ...dbOptions,
                            stream
                        });
                        
                        resolve({ connection, sshClient });
                    } catch (dbErr) {
                        sshClient.end();
                        reject(dbErr);
                    }
                }
            );
        });

        sshClient.on('error', (err) => reject(err));
        sshClient.connect(sshOptions);
    });
}

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    let connection;
    let sshClient;

    try {
        const body = JSON.parse(event.body);
        const { location, patronCode, patronName, items } = body;

        if (!location || !items || !Array.isArray(items)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid batch data' })
            };
        }

        // 1. Establish Tunnel & Connection
        const tunnel = await createTunnel(sshConfig, dbConfig);
        connection = tunnel.connection;
        sshClient = tunnel.sshClient;

        // 2. Try to create the table on cold starts
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS barcode_scans (
                id INT AUTO_INCREMENT PRIMARY KEY,
                location VARCHAR(255) NOT NULL,
                patron_code VARCHAR(255),
                patron_name VARCHAR(255),
                barcode_type VARCHAR(50) NOT NULL,
                barcode_value VARCHAR(255) NOT NULL,
                is_patron_barcode BOOLEAN NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        await connection.query(createTableQuery);

        // 3. Begin Transaction
        await connection.beginTransaction();

        try {
            // 4. Insert Patron if code exists
            if (patronCode) {
                const pQuery = `INSERT INTO barcode_scans (location, patron_code, patron_name, barcode_type, barcode_value, is_patron_barcode) VALUES (?, ?, ?, 'CODE128', ?, true)`;
                await connection.query(pQuery, [location, patronCode, patronName, patronCode]);
            }

            // 5. Insert items
            for (const item of items) {
                const iQuery = `INSERT INTO barcode_scans (location, patron_code, patron_name, barcode_type, barcode_value, is_patron_barcode) VALUES (?, ?, ?, ?, ?, false)`;
                await connection.query(iQuery, [location, patronCode, patronName, item.format || 'CODE39', item.value]);
            }

            // 6. Commit
            await connection.commit();
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, message: 'Batch saved' })
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        }

    } catch (err) {
        console.error('Batch save error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Database or Tunnel error', details: err.message })
        };
    } finally {
        // Always cleanly close connections to avoid Lambda timeouts
        if (connection) await connection.end().catch(e => console.error('Error closing DB', e));
        if (sshClient) sshClient.end();
    }
};
