require('dotenv').config();
const mysql = require('mysql2/promise');
const { Client } = require('ssh2');

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1', 
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
};

function createTunnel(sshOptions, dbOptions) {
    return new Promise((resolve, reject) => {
        const sshClient = new Client();
        
        sshClient.on('ready', () => {
            sshClient.forwardOut(
                '127.0.0.1', 
                12345,       
                dbOptions.host, 
                dbOptions.port, 
                async (err, stream) => {
                    if (err) {
                        sshClient.end();
                        return reject(err);
                    }

                    try {
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
    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const location = event.queryStringParameters.location;

    if (!location) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing location parameter' }) };
    }

    let connection;
    let sshClient;

    try {
        const tunnel = await createTunnel(sshConfig, dbConfig);
        connection = tunnel.connection;
        sshClient = tunnel.sshClient;

        // Fetch all scans for the location ordered by creation time
        const query = `
            SELECT id, patron_code, patron_name, barcode_type, barcode_value, is_patron_barcode, created_at
            FROM barcode_scans 
            WHERE location = ?
            ORDER BY id ASC
        `;
        
        const [rows] = await connection.query(query, [location]);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, data: rows })
        };

    } catch (err) {
        console.error('Fetch data error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Database or Tunnel error', details: err.message })
        };
    } finally {
        if (connection) await connection.end().catch(e => console.error('Error closing DB', e));
        if (sshClient) sshClient.end();
    }
};
