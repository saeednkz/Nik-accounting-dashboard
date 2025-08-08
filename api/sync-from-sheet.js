import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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
        const transactionsRef = collection(db, `artifacts/${appId}/public/data/transactions`);

        // Get all existing transactions to calculate pool values correctly
        const snapshot = await getDocs(transactionsRef);
        const allTransactions = snapshot.docs.map(doc => ({...doc.data(), orderdate: doc.data().orderdate.toDate()}));
        
        // Process each new transaction from the sheet
        for (const tx of transactionsFromSheet) {
            // Re-calculate currency pools for each new transaction to ensure accuracy
            const currentPools = {};
            const sortedTransactions = [...allTransactions].sort((a, b) => new Date(a.orderdate) - new Date(b.orderdate));
            sortedTransactions.forEach(t => processTransactionForPool(t, currentPools));
            
            const pool = currentPools[tx.currencie_slug] || { weightedAvgCost: 0 };
            
            // Calculate NetProfit and Cost_Basis based on your logic
            tx.Cost_Basis = tx.services_type === 'buy' ? parseFloat(tx.currency_price) : (pool.weightedAvgCost > 0 ? pool.weightedAvgCost : parseFloat(tx.currency_price) * 0.98);
            tx.NetProfit = tx.services_type === 'buy' 
                ? (parseFloat(tx['Vip Amount']) || 0) + (parseFloat(tx['Fix Wage']) || 0) + ((parseFloat(tx['Network Wage']) || 0) - (parseFloat(tx['ActualNetwork Wage']) || 0))
                : (parseFloat(tx['Total Amount']) || 0) - ((tx.Cost_Basis * parseFloat(tx.currency_amount)) + (parseFloat(tx['ActualNetwork Wage']) || 0));

            // Convert string numbers to actual numbers
            Object.keys(tx).forEach(key => {
                if (!isNaN(tx[key]) && tx[key] !== '') {
                    tx[key] = parseFloat(tx[key]);
                }
            });

            // Add the processed transaction to Firestore
            await addDoc(transactionsRef, {
                ...tx,
                orderdate: new Date(tx.orderdate),
                createdAt: new Date()
            });
            
            // Add the new transaction to our local list for the next iteration's calculation
            allTransactions.push(tx);
        }

        return response.status(200).json({ success: true, message: `${transactionsFromSheet.length} transactions synced.` });

    } catch (error) {
        console.error('Error syncing from Google Sheet:', error);
        return response.status(500).send({ message: 'Error syncing data', error: error.message });
    }
}

// Helper function to calculate pool values (must be identical to front-end logic)
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
