import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
    getMultiPartyEscrow,
    getEscrowMilestones,
    approveMilestoneOnEscrow,
    createMultiPartyConditionalEscrow,
    activateMultiPartyEscrow,
    addEscrowParticipant,
    addEscrowMilestone,
} from '../../utils/api';

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_META = {
    pending:     { label: 'Pending',     bg: 'bg-gray-100',   text: 'text-gray-600',  dot: 'bg-gray-400'   },
    in_progress: { label: 'In Progress', bg: 'bg-blue-100',   text: 'text-blue-700',  dot: 'bg-blue-500'   },
    approved:    { label: 'Approved',    bg: 'bg-green-100',  text: 'text-green-700', dot: 'bg-green-500'  },
    disputed:    { label: 'Disputed',    bg: 'bg-red-100',    text: 'text-red-700',   dot: 'bg-red-500'    },
    cancelled:   { label: 'Cancelled',   bg: 'bg-gray-100',   text: 'text-gray-500',  dot: 'bg-gray-300'   },
};

const ESCROW_STATUS_META = {
    draft:     { label: 'Draft',     color: 'text-gray-500'  },
    active:    { label: 'Active',    color: 'text-blue-600'  },
    released:  { label: 'Released',  color: 'text-green-600' },
    cancelled: { label: 'Cancelled', color: 'text-red-500'   },
    disputed:  { label: 'Disputed',  color: 'text-orange-600'},
};

const ROLE_ICONS = {
    buyer:     '🛒',
    seller:    '🏪',
    supplier:  '🏭',
    logistics: '🚚',
    arbiter:   '⚖️',
};

function StatusBadge({ status }) {
    const meta = STATUS_META[status] || STATUS_META.pending;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
        </span>
    );
}

function ProgressBar({ completed, total }) {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                    className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
        </div>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MilestoneCard({ milestone, escrowId, currentUserWallet, onApproved, escrowStatus }) {
    const [approving, setApproving] = useState(false);

    const alreadyApproved = Array.isArray(milestone.approvals) &&
        milestone.approvals.some(a => a.wallet_address?.toLowerCase() === currentUserWallet?.toLowerCase());

    const canApprove =
        escrowStatus === 'active' &&
        ['pending', 'in_progress'].includes(milestone.status) &&
        !alreadyApproved;

    const handleApprove = async () => {
        try {
            setApproving(true);
            await approveMilestoneOnEscrow(escrowId, milestone.id);
            toast.success(`Milestone "${milestone.title}" approved`);
            onApproved();
        } catch (err) {
            toast.error(err.response?.data?.error?.message || 'Approval failed');
        } finally {
            setApproving(false);
        }
    };

    return (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3 hover:shadow-sm transition-shadow">
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{milestone.title}</p>
                    {milestone.description && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{milestone.description}</p>
                    )}
                </div>
                <StatusBadge status={milestone.status} />
            </div>

            {/* Approval progress */}
            <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                    <span>Approvals</span>
                    <span>{milestone.approval_count} / {milestone.required_approvals}</span>
                </div>
                <ProgressBar completed={milestone.approval_count} total={milestone.required_approvals} />
            </div>

            {/* Amount + approvers + action */}
            <div className="flex items-center justify-between">
                <div>
                    <span className="text-sm font-semibold text-indigo-700">
                        ${Number(milestone.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                    {Array.isArray(milestone.approvals) && milestone.approvals.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                            {milestone.approvals.map((a) => (
                                <span
                                    key={a.wallet_address}
                                    title={`Approved by ${a.wallet_address}`}
                                    className="inline-block bg-green-50 text-green-700 text-xs px-1.5 py-0.5 rounded font-mono"
                                >
                                    {a.wallet_address.slice(0, 6)}…{a.wallet_address.slice(-4)}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {canApprove && (
                    <button
                        onClick={handleApprove}
                        disabled={approving}
                        className="ml-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300
                                   text-white text-xs font-medium rounded-md transition-colors"
                    >
                        {approving ? 'Approving…' : 'Approve'}
                    </button>
                )}

                {alreadyApproved && (
                    <span className="ml-2 text-xs text-green-600 font-medium flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        You approved
                    </span>
                )}
            </div>
        </div>
    );
}

function ParticipantList({ participants }) {
    if (!participants?.length) return null;
    return (
        <div className="space-y-2">
            {participants.map((p) => (
                <div key={p.wallet_address} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base" aria-hidden>{ROLE_ICONS[p.role] || '👤'}</span>
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-700 capitalize">{p.role}</p>
                            <p className="text-xs text-gray-400 font-mono truncate">
                                {p.wallet_address.slice(0, 10)}…{p.wallet_address.slice(-6)}
                            </p>
                        </div>
                    </div>
                    {!p.is_active && (
                        <span className="text-xs text-gray-400 italic">Inactive</span>
                    )}
                </div>
            ))}
        </div>
    );
}

// ─── Create Escrow Modal ─────────────────────────────────────────────────────

const EMPTY_PARTICIPANT = { walletAddress: '', role: 'buyer' };
const EMPTY_MILESTONE   = { title: '', description: '', amount: '', requiredApprovals: 1 };

function CreateEscrowModal({ invoiceId, onClose, onCreated }) {
    const [form, setForm]         = useState({
        title:      '',
        totalAmount:'',
        currency:   'USDC',
        durationDays: 30,
    });
    const [participants, setParticipants] = useState([{ ...EMPTY_PARTICIPANT }, { ...EMPTY_PARTICIPANT, role: 'seller' }]);
    const [milestones,   setMilestones]   = useState([{ ...EMPTY_MILESTONE }]);
    const [submitting,   setSubmitting]   = useState(false);

    const updateParticipant = (i, field, value) =>
        setParticipants(p => p.map((x, idx) => idx === i ? { ...x, [field]: value } : x));

    const updateMilestone = (i, field, value) =>
        setMilestones(m => m.map((x, idx) => idx === i ? { ...x, [field]: value } : x));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.title || !form.totalAmount) return toast.error('Title and total amount are required');
        if (participants.some(p => !p.walletAddress)) return toast.error('All participant wallet addresses are required');
        if (milestones.some(m => !m.title || !m.amount)) return toast.error('All milestones need a title and amount');

        const milestoneTotal = milestones.reduce((s, m) => s + Number(m.amount), 0);
        if (Math.abs(milestoneTotal - Number(form.totalAmount)) > 0.01) {
            return toast.error(`Milestone amounts (${milestoneTotal}) must sum to total (${form.totalAmount})`);
        }

        try {
            setSubmitting(true);
            const resp = await createMultiPartyConditionalEscrow({
                invoiceId,
                title:           form.title,
                totalAmount:     Number(form.totalAmount),
                currency:        form.currency,
                durationSeconds: Number(form.durationDays) * 86400,
                participants,
                milestones: milestones.map(m => ({
                    ...m,
                    amount:           Number(m.amount),
                    requiredApprovals: Number(m.requiredApprovals),
                })),
            });
            toast.success('Multi-party escrow created');
            onCreated(resp.data.escrow);
        } catch (err) {
            toast.error(err.response?.data?.error?.message || 'Failed to create escrow');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Create Multi-Party Escrow</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Basic info */}
                    <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Details</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <label className="block text-xs text-gray-500 mb-1">Title</label>
                                <input
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={form.title}
                                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                                    placeholder="e.g. Shipment milestone escrow"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Total Amount</label>
                                <input
                                    type="number" min="0" step="0.01"
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={form.totalAmount}
                                    onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))}
                                    placeholder="1000.00"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Duration (days)</label>
                                <input
                                    type="number" min="1"
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={form.durationDays}
                                    onChange={e => setForm(f => ({ ...f, durationDays: e.target.value }))}
                                />
                            </div>
                        </div>
                    </section>

                    {/* Participants */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Participants</h3>
                            <button
                                type="button"
                                onClick={() => setParticipants(p => [...p, { ...EMPTY_PARTICIPANT }])}
                                className="text-xs text-indigo-600 hover:underline"
                            >
                                + Add
                            </button>
                        </div>
                        {participants.map((p, i) => (
                            <div key={i} className="flex gap-2 items-center">
                                <input
                                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    placeholder="0x…"
                                    value={p.walletAddress}
                                    onChange={e => updateParticipant(i, 'walletAddress', e.target.value)}
                                    required
                                />
                                <select
                                    className="border border-gray-300 rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={p.role}
                                    onChange={e => updateParticipant(i, 'role', e.target.value)}
                                >
                                    {['buyer', 'seller', 'supplier', 'logistics', 'arbiter'].map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                                {participants.length > 2 && (
                                    <button
                                        type="button"
                                        onClick={() => setParticipants(p => p.filter((_, idx) => idx !== i))}
                                        className="text-red-400 hover:text-red-600 px-1"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        ))}
                    </section>

                    {/* Milestones */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Milestones</h3>
                            <button
                                type="button"
                                onClick={() => setMilestones(m => [...m, { ...EMPTY_MILESTONE }])}
                                className="text-xs text-indigo-600 hover:underline"
                            >
                                + Add
                            </button>
                        </div>
                        {milestones.map((m, i) => (
                            <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-gray-500">Milestone {i + 1}</span>
                                    {milestones.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => setMilestones(m => m.filter((_, idx) => idx !== i))}
                                            className="text-red-400 hover:text-red-600 text-xs"
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                                <input
                                    className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    placeholder="Title"
                                    value={m.title}
                                    onChange={e => updateMilestone(i, 'title', e.target.value)}
                                    required
                                />
                                <input
                                    className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    placeholder="Description (optional)"
                                    value={m.description}
                                    onChange={e => updateMilestone(i, 'description', e.target.value)}
                                />
                                <div className="flex gap-2">
                                    <input
                                        type="number" min="0" step="0.01"
                                        className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        placeholder="Amount"
                                        value={m.amount}
                                        onChange={e => updateMilestone(i, 'amount', e.target.value)}
                                        required
                                    />
                                    <div className="flex items-center gap-1">
                                        <label className="text-xs text-gray-500 whitespace-nowrap">Approvals needed</label>
                                        <input
                                            type="number" min="1"
                                            className="w-16 border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            value={m.requiredApprovals}
                                            onChange={e => updateMilestone(i, 'requiredApprovals', e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </section>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-md font-medium"
                        >
                            {submitting ? 'Creating…' : 'Create Escrow'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * MilestoneTracker
 *
 * Shows all milestones for a multi-party conditional escrow linked to the given
 * invoice. Clicking "Approve" on a milestone calls the backend API and updates
 * local state optimistically. When no escrowId is provided a "Create" button
 * is shown so the user can initialise the escrow from this component.
 *
 * Props:
 *  - invoiceId      {string}  UUID of the invoice (used when creating a new escrow)
 *  - escrowId       {string?} UUID of an existing multi_party_escrows record
 *  - currentUserWallet {string?} Connected wallet (for showing "You approved" state)
 *  - userRole       {string?} Current user's role (controls whether create button shown)
 *  - onEscrowCreated {function?} Called with the new escrow object after creation
 */
export default function MilestoneTracker({
    invoiceId,
    escrowId: initialEscrowId,
    currentUserWallet,
    userRole,
    onEscrowCreated,
}) {
    const [escrowId,     setEscrowId]     = useState(initialEscrowId || null);
    const [escrow,       setEscrow]       = useState(null);
    const [loading,      setLoading]      = useState(false);
    const [showCreate,   setShowCreate]   = useState(false);
    const [activating,   setActivating]   = useState(false);

    const canCreate   = ['seller', 'admin'].includes(userRole);
    const canActivate = canCreate && escrow?.status === 'draft';

    // ── Data fetching ──
    const loadEscrow = useCallback(async () => {
        if (!escrowId) return;
        try {
            setLoading(true);
            const resp = await getMultiPartyEscrow(escrowId);
            setEscrow(resp.data.escrow);
        } catch (err) {
            if (err.response?.status !== 404) {
                toast.error('Failed to load escrow details');
            }
        } finally {
            setLoading(false);
        }
    }, [escrowId]);

    useEffect(() => { loadEscrow(); }, [loadEscrow]);

    // ── Handlers ──
    const handleCreated = (newEscrow) => {
        setShowCreate(false);
        setEscrowId(newEscrow.escrow_id);
        setEscrow(newEscrow);
        onEscrowCreated?.(newEscrow);
    };

    const handleActivate = async () => {
        try {
            setActivating(true);
            await activateMultiPartyEscrow(escrowId);
            toast.success('Escrow published to blockchain');
            loadEscrow();
        } catch (err) {
            toast.error(err.response?.data?.error?.message || 'Activation failed');
        } finally {
            setActivating(false);
        }
    };

    // ── Loading skeleton ──
    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4 animate-pulse">
                <div className="h-5 w-40 bg-gray-200 rounded" />
                {[1, 2, 3].map(i => (
                    <div key={i} className="h-20 bg-gray-100 rounded-lg" />
                ))}
            </div>
        );
    }

    // ── Empty state: no escrow yet ──
    if (!escrowId || !escrow) {
        return (
            <>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 flex flex-col items-center text-center space-y-4">
                    <div className="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center text-2xl">🔐</div>
                    <div>
                        <p className="font-semibold text-gray-800">No milestone escrow yet</p>
                        <p className="text-sm text-gray-500 mt-1">
                            Set up a multi-party conditional escrow to track payment milestones for this invoice.
                        </p>
                    </div>
                    {canCreate && (
                        <button
                            onClick={() => setShowCreate(true)}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
                        >
                            Create Milestone Escrow
                        </button>
                    )}
                </div>
                {showCreate && (
                    <CreateEscrowModal
                        invoiceId={invoiceId}
                        onClose={() => setShowCreate(false)}
                        onCreated={handleCreated}
                    />
                )}
            </>
        );
    }

    const approvedMilestones = escrow.milestones?.filter(m => m.status === 'approved').length ?? 0;
    const totalMilestones    = escrow.milestones?.length ?? 0;
    const escrowStatusMeta   = ESCROW_STATUS_META[escrow.status] || ESCROW_STATUS_META.draft;

    // ── Main tracker view ──
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div>
                    <h3 className="font-semibold text-gray-900">{escrow.title}</h3>
                    <p className={`text-xs font-medium mt-0.5 ${escrowStatusMeta.color}`}>
                        {escrowStatusMeta.label}
                        {escrow.on_chain_tx_hash && (
                            <span className="text-gray-400 font-normal ml-1">· on-chain</span>
                        )}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-xs text-gray-500">Total</p>
                    <p className="text-base font-bold text-gray-900">
                        ${Number(escrow.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        <span className="text-xs font-normal text-gray-400 ml-1">{escrow.currency}</span>
                    </p>
                </div>
            </div>

            {/* Overall progress */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Milestones complete</span>
                    <span>{approvedMilestones} / {totalMilestones}</span>
                </div>
                <ProgressBar completed={approvedMilestones} total={totalMilestones} />
                <div className="flex justify-between text-xs text-gray-500 mt-2">
                    <span>Released</span>
                    <span>
                        ${Number(escrow.released_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        &nbsp;/&nbsp;
                        ${Number(escrow.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                </div>
            </div>

            <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Milestones list */}
                <div className="lg:col-span-2 space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700">Milestones</h4>
                    {escrow.milestones?.length > 0 ? (
                        escrow.milestones.map((m) => (
                            <MilestoneCard
                                key={m.id}
                                milestone={m}
                                escrowId={escrowId}
                                currentUserWallet={currentUserWallet}
                                onApproved={loadEscrow}
                                escrowStatus={escrow.status}
                            />
                        ))
                    ) : (
                        <p className="text-sm text-gray-400 italic">No milestones defined yet.</p>
                    )}
                </div>

                {/* Sidebar */}
                <div className="space-y-4">
                    {/* Participants */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Participants</h4>
                        <ParticipantList participants={escrow.participants} />
                    </div>

                    {/* Actions */}
                    {(canActivate || canCreate) && (
                        <div className="space-y-2 pt-2 border-t border-gray-100">
                            {canActivate && (
                                <button
                                    onClick={handleActivate}
                                    disabled={activating}
                                    className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300
                                               text-white text-sm font-medium rounded-lg transition-colors"
                                >
                                    {activating ? 'Publishing…' : '⛓ Publish to Blockchain'}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Expiry */}
                    {escrow.expires_at && (
                        <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                            <span className="font-medium">Expires:</span>{' '}
                            {new Date(escrow.expires_at).toLocaleDateString()}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
