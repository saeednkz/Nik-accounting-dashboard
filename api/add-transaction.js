// Import the Google Sheets API library
const { google } = require('googleapis');

export default async function handler(request, response) {
    // Ensure the request is a POST request
    if (request.method !== 'POST') {
        return response.status(405).send({ message: 'Only POST requests allowed' });
    }

    try {
        // Get the transaction data from the request body
        const transaction = request.body;

        // --- Authentication with Google ---
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                // Replace \n with actual newlines
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // --- Prepare the data row ---
        // The order of items in this array MUST match the order of columns in your Google Sheet
        const rowData = [
            transaction.orderid || '',
            new Date(transaction.orderdate).toLocaleString('fa-IR'),
            transaction.userid || '',
            transaction.first_name || '',
            transaction.last_name || '',
            transaction.Mobile || '',
            transaction.Email || '',
            transaction.service_slug || '',
            transaction.categories_title || '',
            transaction.services_type || '',
            transaction.currency || '',
            transaction.currencie_slug || '',
            transaction['Source Wallet Address'] || '',
            transaction['Destination Wallet Address'] || '',
            transaction.Txid || '',
            transaction.currency_amount || 0,
            transaction['Is Crypto?'] ? 'Yes' : 'No',
            transaction.crypto_total_usdt || 0,
            transaction.currency_price || 0,
            transaction.Cost_Basis || 0,
            transaction['Network Wage'] || 0,
            transaction['ActualNetwork Wage'] || 0,
            transaction['Fix Wage'] || 0,
            transaction['Total Amount'] || 0,
            transaction['Vip Amount'] || 0,
            transaction['Voucher Amount'] || 0,
            transaction['Vouchers Code'] || '',
            transaction.description || '',
            transaction.NetProfit || 0,
        ];
        
        // --- Append the row to the Google Sheet ---
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A2', // Assumes your data starts from row 2 in a sheet named 'Sheet1'
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [rowData],
            },
        });

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error('Error writing to Google Sheet:', error);
        return response.status(500).send({ message: 'Error writing to Google Sheet', error: error.message });
    }
}
