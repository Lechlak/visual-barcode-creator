# Visual Barcode Creator
A web application to easily scan patron barcodes and items, visualize the barcodes, and sync the data to a remote MySQL database using Netlify Serverless Functions.

## Setup for Local Development
1. `npm install`
2. `npm install netlify-cli -g`
3. Create a `.env` file based on `.env.example` and put the correct DB credentials.
4. `netlify dev` to run the local server.

## Usage
Add `?location=XYZ` to the URL. Enter the Patron's name/code first. The UI will then ask for the items. Upon completion, it submits the data to the Netlify backend API and saves it directly to the database.
