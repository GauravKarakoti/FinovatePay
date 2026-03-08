import React, { useEffect, useState } from 'react';
import { getTreasuryBalance, getTreasuryTransactions, getTreasuryReports, withdrawFromTreasury } from '../utils/api';
import { toast } from 'sonner';

const TreasuryDashboard = () => {
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [reports, setReports] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const balRes = await getTreasuryBalance();
      setBalance(balRes.data);

      const txRes = await getTreasuryTransactions();
      setTransactions(txRes.data.events || []);

      const reportsRes = await getTreasuryReports({ lookbackBlocks: 50000 });
      setReports(reportsRes.data.totals || {});
    } catch (err) {
      console.error('Failed to load treasury data', err);
      toast.error('Failed to load treasury data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleWithdraw = async () => {
    const to = prompt('Enter recipient address');
    const amount = prompt('Enter amount (in wei for tokens/native)');
    if (!to || !amount) return;
    try {
      const res = await withdrawFromTreasury(null, to, amount);
      toast.success('Withdrawal submitted: ' + res.data.txHash);
      loadData();
    } catch (err) {
      console.error(err);
      toast.error('Withdrawal failed');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Treasury Dashboard</h1>
        <div>
          <button onClick={loadData} className="bg-blue-600 text-white px-3 py-1 rounded mr-2">Refresh</button>
          <button onClick={handleWithdraw} className="bg-red-600 text-white px-3 py-1 rounded">Withdraw</button>
        </div>
      </div>

      {isLoading && <div>Loading...</div>}

      {balance && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white p-4 rounded shadow">
            <h3 className="font-semibold mb-2">Native Balance</h3>
            <div className="font-mono">{balance.native}</div>
          </div>
          <div className="bg-white p-4 rounded shadow">
            <h3 className="font-semibold mb-2">Token Totals (recent)</h3>
            {Object.keys(reports).length === 0 ? (
              <div className="text-sm text-gray-500">No report data</div>
            ) : (
              <ul>
                {Object.entries(reports).map(([token, amt]) => (
                  <li key={token} className="font-mono text-sm">{token}: {amt}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="bg-white p-4 rounded shadow">
        <h3 className="font-semibold mb-2">Recent Treasury Events</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-2 py-2">Event</th>
                <th className="px-2 py-2">Details</th>
                <th className="px-2 py-2">Tx</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((ev, i) => (
                <tr key={i} className="odd:bg-gray-50">
                  <td className="px-2 py-2 font-medium">{ev.name}</td>
                  <td className="px-2 py-2 font-mono text-xs">{JSON.stringify(ev.args)}</td>
                  <td className="px-2 py-2"><a href={`https://explorer.example/tx/${ev.txHash}`} className="text-blue-600">{ev.txHash?.slice(0,12)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TreasuryDashboard;
