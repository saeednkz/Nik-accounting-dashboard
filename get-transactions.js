const { google } = require('googleapis');

export default async function handler(request, response) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:AC', // Read all columns from A to AC
        });

        const rows = sheetData.data.values;

        if (!rows || rows.length < 2) { // Check if there's at least one data row
            return response.status(200).json([]);
        }

        // The first row is the header
        const headers = rows[0].map(header => header.replace(/\s+/g, '_')); // Sanitize headers
        
        // Convert rows to JSON objects
        const transactions = rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index];
            });
            return obj;
        });

        return response.status(200).json(transactions);

    } catch (error) {
        console.error('Error reading from Google Sheet:', error);
        return response.status(500).send({ message: 'Error reading from Google Sheet', error: error.message });
    }
}
