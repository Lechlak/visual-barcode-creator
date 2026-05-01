# Visual Barcode Creator
A web application to easily scan patron barcodes and items, visualize the barcodes, and sync the data to a remote MySQL database.

## Setup
1. `npm install`
2. Create a `.env` file based on `.env.example` and put the correct DB credentials.
3. `npm start` (or `node server.js`)

## Usage
Add `?location=XYZ` to the URL. Enter the Patron's name/code first. The UI will then ask for the items. Upon completion, it submits the data to the Node backend API and saves it directly to the database.
