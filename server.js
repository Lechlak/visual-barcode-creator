const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

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

async function initDB() {
    try {
        pool = mysql.createPool(dbConfig);

        // Attempt to create table if not exists.
        // If the connection fails here (e.g. timeout), we will catch it.
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
        console.log('Database initialized and barcode_scans table checked/created.');
    } catch (err) {
        console.error('Failed to initialize database (this might be normal if the firewall blocks connection from this environment):', err.message);
        // We do not exit the process because we still want to serve the frontend,
        // and we want this script to be able to run even if the initial DB check fails
        // due to network restrictions.
    }
}

initDB();

app.post('/api/save', async (req, res) => {
    const { location, patronCode, patronName, barcodeType, barcodeValue, isPatronBarcode } = req.body;

    if (!location || !barcodeValue) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        if (!pool) {
            // Re-attempt creating pool if it wasn't created initially
             pool = mysql.createPool(dbConfig);
        }

        const insertQuery = `
            INSERT INTO barcode_scans
            (location, patron_code, patron_name, barcode_type, barcode_value, is_patron_barcode)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const [result] = await pool.query(insertQuery, [
            location,
            patronCode || null,
            patronName || null,
            barcodeType || 'CODE128',
            barcodeValue,
            isPatronBarcode
        ]);

        res.status(200).json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Error saving data to database:', err);
        res.status(500).json({ error: 'Database error', details: err.message });
    }
});

// For multiple items batch save
app.post('/api/save-batch', async (req, res) => {
    const { location, patronCode, patronName, items } = req.body;

    if (!location || !items || !Array.isArray(items)) {
         return res.status(400).json({ error: 'Invalid batch data' });
    }

    try {
        if (!pool) pool = mysql.createPool(dbConfig);
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
            res.status(200).json({ success: true, message: 'Batch saved' });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error('Batch save error:', err);
        res.status(500).json({ error: 'Database error', details: err.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'barcode-generator.html'));
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
