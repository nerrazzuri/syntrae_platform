import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

export const BrandsAnalytics = () => {
    const [brands, setBrands] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('30');

    useEffect(() => {
        loadData();
    }, [range]);

    const loadData = async () => {
        setLoading(true);
        try {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - parseInt(range, 10));

            const res = await api.analytics.getBrands({
                from: start.toISOString(),
                to: end.toISOString()
            });
            setBrands(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading && brands.length === 0) return <div className="p-8">Loading brands...</div>;

    const maxLeads = Math.max(...brands.map(b => b.metrics.total_leads), 1);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Brand Performance</h1>
                    <p className="text-sm text-gray-500">Compare which brands turn comment demand into worked pipeline and revenue.</p>
                </div>
                <select
                    value={range}
                    onChange={e => setRange(e.target.value)}
                    className="bg-white border rounded-md px-3 py-1 text-sm shadow-sm"
                >
                    <option value="7">Last 7 Days</option>
                    <option value="30">Last 30 Days</option>
                    <option value="90">Last 90 Days</option>
                </select>
            </div>

            <div className="bg-white rounded-md border shadow-sm">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Leads</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contacted</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Converted</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conversion Rate</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Top Intent</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {brands.map((brand) => (
                            <tr key={brand.id}>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">{brand.name}</div>
                                    <div className="w-24 mt-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                        <div
                                            className="bg-indigo-500 h-1.5 rounded-full"
                                            style={{ width: `${(brand.metrics.total_leads / maxLeads) * 100}%` }}
                                        />
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{brand.metrics.total_leads}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{brand.metrics.contacted_leads}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{brand.metrics.converted_leads}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {((brand.metrics.conversion_rate || 0) * 100).toFixed(1)}%
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(brand.metrics.estimated_revenue || 0)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {brand.intents[0] ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                            {brand.intents[0].intent}
                                        </span>
                                    ) : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {brands.length === 0 && !loading && (
                <div className="text-center text-gray-500 p-8">No brands found.</div>
            )}
        </div>
    );
};
