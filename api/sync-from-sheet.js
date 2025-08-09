import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// --- Firebase Admin SDK Initialization ---
// This code initializes the Firebase connection on the server-side.
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

// --- Main API Handler ---
export default async function handler(request, response) {
    // 1. Security Check: Ensure the request is from our Google Sheet
    if (request.method !== 'POST') {
        return response.status(405).send({ message: 'Only POST requests allowed' });
    }
    const secret = request.headers['x-sync-secret'];
    if (secret !== process.env.SYNC_SECRET_KEY) {
        return response.status(401).send({ message: 'Unauthorized' });
    }

    try {
        const transactionsFromSheet = request.body;
        const appId = process.env.FIREBASE_PROJECT_ID;
        const transactionsRef = db.collection(`artifacts/${appId}/public/data/transactions`);

        // Get all existing transactions to calculate pool values correctly
        const snapshot = await transactionsRef.get();
        const allTransactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {...data, orderdate: data.orderdate.toDate()};
        });
        
        // Process each new transaction from the sheet
        for (const tx of transactionsFromSheet) {
            const currentPools = {};
            const sortedTransactions = [...allTransactions].sort((a, b) => new Date(a.orderdate) - new Date(b.orderdate));
            sortedTransactions.forEach(t => processTransactionForPool(t, currentPools));
            
            const pool = currentPools[tx.currencie_slug] || { weightedAvgCost: 0 };
            
            // --- Calculations ---
            const currency_price = parseFloat(tx.currency_price) || 0;
            const currency_amount = parseFloat(tx.currency_amount) || 0;
            const Vip_Amount = parseFloat(tx['Vip Amount']) || 0;
            const Fix_Wage = parseFloat(tx['Fix Wage']) || 0;
            const Network_Wage = parseFloat(tx['Network Wage']) || 0;
            const ActualNetwork_Wage = parseFloat(tx['ActualNetwork Wage']) || 0;
            const Total_Amount = parseFloat(tx['Total Amount']) || 0;
            
            const costBasis = tx.services_type === 'buy' ? currency_price : (pool.weightedAvgCost > 0 ? pool.weightedAvgCost : currency_price * 0.98);
            const netProfit = tx.services_type === 'buy' 
                ? Vip_Amount + Fix_Wage + (Network_Wage - ActualNetwork_Wage)
                : Total_Amount - ((costBasis * currency_amount) + ActualNetwork_Wage);

            // Prepare data for Firestore
            const firestoreTx = {
                ...tx,
                orderdate: Timestamp.fromDate(new Date(tx.orderdate)),
                createdAt: Timestamp.now(),
                Cost_Basis: costBasis,
                NetProfit: netProfit
            };

            // Convert string numbers to actual numbers
            Object.keys(firestoreTx).forEach(key => {
                const val = firestoreTx[key];
                if (typeof val === 'string' && !isNaN(val) && val.trim() !== '') {
                    // Exclude fields that should remain strings like Mobile, orderid
                    if (!['Mobile', 'orderid', 'uid', 'role', 'name', 'email'].includes(key) && !key.includes('Address') && !key.includes('slug') && !key.includes('Code')) {
                         firestoreTx[key] = parseFloat(val);
                    }
                }
            });
            
            await transactionsRef.add(firestoreTx);
            
            allTransactions.push({...firestoreTx, orderdate: firestoreTx.orderdate.toDate()});
        }

        return response.status(200).json({ success: true, message: `${transactionsFromSheet.length} transactions synced.` });

    } catch (error) {
        console.error('Error syncing from Google Sheet:', error);
        return response.status(500).send({ message: 'Error syncing data', error: error.message });
    }
}

// Helper function to calculate pool values
function processTransactionForPool(t, pools) {
    if (!pools[t.currencie_slug]) {
        pools[t.currencie_slug] = { quantity: 0, weightedAvgCost: 0 };
    }
    const pool = pools[t.currencie_slug];
    if (t.services_type === 'buy') {
        const newTotalQty = pool.quantity + t.currency_amount;
        pool.weightedAvgCost = newTotalQty > 0 ? ((pool.quantity * pool.weightedAvgCost) + (t.currency_amount * t.currency_price)) / newTotalQty : 0;
        pool.quantity = newTotalQty;
    } else {
        pool.quantity -= t.currency_amount;
    }
}
