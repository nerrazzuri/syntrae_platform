interface PaginationControlsProps {
    total: number;
    page: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    label?: string;
}

export function PaginationControls({
    total,
    page,
    pageSize,
    onPageChange,
    onPageSizeChange,
    label = 'items',
}: PaginationControlsProps) {
    const safeTotal = Math.max(0, total);
    const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const start = safeTotal === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(safeTotal, currentPage * pageSize);

    return (
        <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-500">
                Showing {start}-{end} of {safeTotal} {label}
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-500">
                    Per page
                    <select
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        value={pageSize}
                        onChange={(event) => onPageSizeChange(Number(event.target.value))}
                    >
                        {[10, 25, 50].map((size) => (
                            <option key={size} value={size}>
                                {size}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onPageChange(currentPage - 1)}
                        disabled={currentPage <= 1}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Previous
                    </button>
                    <div className="min-w-[92px] text-center text-sm font-semibold text-slate-600">
                        Page {currentPage} / {totalPages}
                    </div>
                    <button
                        type="button"
                        onClick={() => onPageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}
