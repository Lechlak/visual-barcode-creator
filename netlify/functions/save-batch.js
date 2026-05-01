const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST || '162.159.134.42',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000 // 10 seconds timeout
};

let pool;

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const body = JSON.parse(event.body);
        const { location, patronCode, patronName, items } = body;

        if (!location || !items || !Array.isArray(items)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid batch data' })
            };
        }

        if (!pool) {
            pool = mysql.createPool(dbConfig);

            // Try to create the table on cold starts just to be safe
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
            await pool.query(createTableQuery);
        }

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // 1. Insert Patron if code exists
            if (patronCode) {
                const pQuery = `INSERT INTO barcode_scans (location, patron_code, patron_name, barcode_type, barcode_value, is_patron_barcode) VALUES (?, ?, ?, 'CODE128', ?, true)`;
                await connection.query(pQuery, [location, patronCode, patronName, patronCode]);
            }

            // 2. Insert items
            for (const item of items) {
                const iQuery = `INSERT INTO barcode_scans (location, patron_code, patron_name, barcode_type, barcode_value, is_patron_barcode) VALUES (?, ?, ?, ?, ?, false)`;
                await connection.query(iQuery, [location, patronCode, patronName, item.format || 'CODE128', item.value]);
            }

            await connection.commit();
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, message: 'Batch saved' })
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error('Batch save error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Database error', details: err.message })
        };
    }
};
