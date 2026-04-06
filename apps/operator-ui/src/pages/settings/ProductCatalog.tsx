import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';

type CatalogItem = {
    id: string;
    name: string;
    category?: string | null;
    description: string;
    price_label?: string | null;
    target_buyer?: string | null;
    key_benefits: string[];
    common_objections: string[];
    cta_url?: string | null;
    cta_label?: string | null;
    availability_status: string;
    forbidden_claims: string[];
    priority: number;
    status: 'ACTIVE' | 'ARCHIVED';
    updated_at: string;
};

type CatalogForm = {
    name: string;
    category: string;
    description: string;
    price_label: string;
    target_buyer: string;
    key_benefits: string;
    common_objections: string;
    cta_url: string;
    cta_label: string;
    availability_status: string;
    forbidden_claims: string;
    priority: number;
};

const emptyForm: CatalogForm = {
    name: '',
    category: '',
    description: '',
    price_label: '',
    target_buyer: '',
    key_benefits: '',
    common_objections: '',
    cta_url: '',
    cta_label: '',
    availability_status: 'AVAILABLE',
    forbidden_claims: '',
    priority: 50,
};

function splitLines(value: string): string[] {
    return value
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function joinLines(value: string[] | undefined): string {
    return (value || []).join('\n');
}

function itemToForm(item: CatalogItem): CatalogForm {
    return {
        name: item.name || '',
        category: item.category || '',
        description: item.description || '',
        price_label: item.price_label || '',
        target_buyer: item.target_buyer || '',
        key_benefits: joinLines(item.key_benefits),
        common_objections: joinLines(item.common_objections),
        cta_url: item.cta_url || '',
        cta_label: item.cta_label || '',
        availability_status: item.availability_status || 'AVAILABLE',
        forbidden_claims: joinLines(item.forbidden_claims),
        priority: item.priority ?? 50,
    };
}

function formToPayload(form: CatalogForm) {
    return {
        name: form.name,
        category: form.category || null,
        description: form.description,
        price_label: form.price_label || null,
        target_buyer: form.target_buyer || null,
        key_benefits: splitLines(form.key_benefits),
        common_objections: splitLines(form.common_objections),
        cta_url: form.cta_url || null,
        cta_label: form.cta_label || null,
        availability_status: form.availability_status || 'AVAILABLE',
        forbidden_claims: splitLines(form.forbidden_claims),
        priority: form.priority,
    };
}

export function ProductCatalogPage() {
    const { brandId } = useParams();
    const [items, setItems] = useState<CatalogItem[]>([]);
    const [form, setForm] = useState<CatalogForm>(emptyForm);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const activeCount = useMemo(() => items.filter((item) => item.status === 'ACTIVE').length, [items]);

    const loadItems = async () => {
        if (!brandId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await api.get(`/brands/${brandId}/catalog`);
            setItems(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load product catalog');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadItems();
    }, [brandId]);

    const updateField = <K extends keyof CatalogForm>(field: K, value: CatalogForm[K]) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const resetForm = () => {
        setForm(emptyForm);
        setEditingId(null);
    };

    const saveItem = async (event: FormEvent) => {
        event.preventDefault();
        if (!brandId) return;
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const payload = formToPayload(form);
            if (editingId) {
                await api.patch(`/brands/${brandId}/catalog/${editingId}`, payload);
                setSuccess('Catalog item updated.');
            } else {
                await api.post(`/brands/${brandId}/catalog`, payload);
                setSuccess('Catalog item added.');
            }
            resetForm();
            await loadItems();
        } catch (err: any) {
            setError(err.message || 'Failed to save catalog item');
        } finally {
            setSaving(false);
        }
    };

    const archiveItem = async (itemId: string) => {
        if (!brandId) return;
        setError(null);
        setSuccess(null);
        try {
            await api.delete(`/brands/${brandId}/catalog/${itemId}`);
            setSuccess('Catalog item archived.');
            await loadItems();
            if (editingId === itemId) resetForm();
        } catch (err: any) {
            setError(err.message || 'Failed to archive catalog item');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                        <Link to="/brands" className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">
                            Back to Brands
                        </Link>
                        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Brand Knowledge</p>
                        <h1 className="mt-2 text-3xl font-bold text-slate-950">Product Catalog</h1>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                            Add the products, services, offers, and restrictions Syntrae should understand when matching comments and drafting replies.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-white px-5 py-4 shadow-sm">
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Active Offers</div>
                        <div className="mt-1 text-3xl font-bold text-slate-950">{activeCount}</div>
                    </div>
                </div>

                {(error || success) && (
                    <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                        {error || success}
                    </div>
                )}

                <div className="grid gap-6 lg:grid-cols-[1fr_1.25fr]">
                    <form onSubmit={saveItem} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold text-slate-950">{editingId ? 'Edit catalog item' : 'Add catalog item'}</h2>
                                <p className="mt-1 text-sm text-slate-500">Keep entries concise and factual. The AI will use this as reply context.</p>
                            </div>
                            {editingId && (
                                <button type="button" onClick={resetForm} className="text-sm font-semibold text-slate-500 hover:text-slate-900">
                                    Cancel
                                </button>
                            )}
                        </div>

                        <div className="mt-6 space-y-4">
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Product / offer name</span>
                                <input required value={form.name} onChange={(e) => updateField('name', e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="Sensitive Skin Starter Kit" />
                            </label>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Category</span>
                                    <input value={form.category} onChange={(e) => updateField('category', e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="Skincare" />
                                </label>
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Price label</span>
                                    <input value={form.price_label} onChange={(e) => updateField('price_label', e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="From RM89" />
                                </label>
                            </div>
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Description</span>
                                <textarea required value={form.description} onChange={(e) => updateField('description', e.target.value)} rows={4} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="What this offer is, who it helps, and when to recommend it." />
                            </label>
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Target buyer</span>
                                <input value={form.target_buyer} onChange={(e) => updateField('target_buyer', e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="Malaysia shoppers with sensitive skin" />
                            </label>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Key benefits</span>
                                    <textarea value={form.key_benefits} onChange={(e) => updateField('key_benefits', e.target.value)} rows={4} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="One per line" />
                                </label>
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Common objections</span>
                                    <textarea value={form.common_objections} onChange={(e) => updateField('common_objections', e.target.value)} rows={4} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="One per line" />
                                </label>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">CTA URL</span>
                                    <input value={form.cta_url} onChange={(e) => updateField('cta_url', e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="https://..." />
                                </label>
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">CTA label</span>
                                    <input value={form.cta_label} onChange={(e) => updateField('cta_label', e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="View product" />
                                </label>
                            </div>
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Forbidden claims</span>
                                <textarea value={form.forbidden_claims} onChange={(e) => updateField('forbidden_claims', e.target.value)} rows={3} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="Claims the AI must avoid, one per line" />
                            </label>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Availability</span>
                                    <input value={form.availability_status} onChange={(e) => updateField('availability_status', e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" placeholder="AVAILABLE" />
                                </label>
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Priority</span>
                                    <input type="number" min={0} max={100} value={form.priority} onChange={(e) => updateField('priority', Number(e.target.value))} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" />
                                </label>
                            </div>
                            <button disabled={saving} type="submit" className="w-full rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add to Catalog'}
                            </button>
                        </div>
                    </form>

                    <div className="space-y-4">
                        {loading && <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading catalog...</div>}
                        {!loading && items.length === 0 && (
                            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
                                No catalog items yet. Add the first offer so Syntrae can match comments to what the business actually sells.
                            </div>
                        )}
                        {items.map((item) => (
                            <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-lg font-bold text-slate-950">{item.name}</h3>
                                            {item.category && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{item.category}</span>}
                                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Priority {item.priority}</span>
                                        </div>
                                        <p className="mt-3 text-sm leading-6 text-slate-600">{item.description}</p>
                                        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                                            {item.price_label && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{item.price_label}</span>}
                                            {item.target_buyer && <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{item.target_buyer}</span>}
                                            {item.cta_url && <a href={item.cta_url} target="_blank" rel="noreferrer" className="rounded-full bg-slate-900 px-3 py-1 text-white">CTA link</a>}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <button onClick={() => { setEditingId(item.id); setForm(itemToForm(item)); }} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                                            Edit
                                        </button>
                                        <button onClick={() => archiveItem(item.id)} className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">
                                            Archive
                                        </button>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
