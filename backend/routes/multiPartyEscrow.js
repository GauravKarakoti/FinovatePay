'use strict';

const express = require('express');
const router  = express.Router();

const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC }                     = require('../middleware/kycValidation');
const { logAudit }                       = require('../middleware/auditLogger');
const errorResponse                      = require('../utils/errorResponse');
const { emitToInvoice, emitToUser }      = require('../socket');
const svc                                = require('../services/multiPartyEscrowService');

// All routes require a valid JWT and KYC clearance
router.use(authenticateToken);
router.use(requireKYC);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/escrow/milestones
// Create a new multi-party conditional escrow (off-chain record, status=draft)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    '/',
    requireRole(['seller', 'admin']),
    async (req, res) => {
        const {
            invoiceId, title, description, totalAmount, currency,
            tokenAddress, durationSeconds, participants, milestones,
        } = req.body;

        if (!title || !totalAmount) {
            return errorResponse(res, 'title and totalAmount are required', 400);
        }
        if (!Array.isArray(participants) || participants.length < 2) {
            return errorResponse(res, 'At least 2 participants are required', 400);
        }
        if (!Array.isArray(milestones) || milestones.length === 0) {
            return errorResponse(res, 'At least one milestone is required', 400);
        }

        try {
            const escrow = await svc.createEscrow({
                invoiceId,
                title,
                description,
                totalAmount,
                currency,
                tokenAddress,
                durationSeconds,
                participants,
                milestones,
                createdByUserId: req.user.id,
            });

            const io = req.app.get('io');
            if (io && invoiceId) {
                emitToInvoice(io, invoiceId, 'escrow:milestone:created', {
                    escrowId: escrow.escrow_id,
                    title:    escrow.title,
                });
            }

            await logAudit({
                operationType: 'MULTI_PARTY_ESCROW_CREATE',
                entityType:    'ESCROW',
                entityId:      escrow.escrow_id,
                actorId:       req.user.id,
                actorWallet:   req.user.wallet_address,
                actorRole:     req.user.role,
                action:        'CREATE',
                status:        'SUCCESS',
                newValues:     { escrow_id: escrow.escrow_id, total_amount: totalAmount },
                ipAddress:     req.ip,
                userAgent:     req.get('user-agent'),
            });

            return res.status(201).json({ success: true, escrow });
        } catch (err) {
            console.error('[MultiPartyEscrow] create error:', err);
            await logAudit({
                operationType: 'MULTI_PARTY_ESCROW_CREATE',
                entityType:    'ESCROW',
                entityId:      req.body?.invoiceId,
                actorId:       req.user?.id,
                actorWallet:   req.user?.wallet_address,
                actorRole:     req.user?.role,
                action:        'CREATE',
                status:        'FAILED',
                errorMessage:  err.message,
                ipAddress:     req.ip,
                userAgent:     req.get('user-agent'),
            });
            return errorResponse(res, err.message, 500);
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/escrow/milestones/:escrowId/activate
// Publish the escrow and its milestones to the blockchain (status → active)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    '/:escrowId/activate',
    requireRole(['seller', 'admin']),
    async (req, res) => {
        const { escrowId }                   = req.params;
        const { tokenAddress, durationSeconds } = req.body;

        try {
            const receipt = await svc.activateOnChain(escrowId, tokenAddress, durationSeconds);

            await logAudit({
                operationType: 'MULTI_PARTY_ESCROW_ACTIVATE',
                entityType:    'ESCROW',
                entityId:      escrowId,
                actorId:       req.user.id,
                actorWallet:   req.user.wallet_address,
                actorRole:     req.user.role,
                action:        'UPDATE',
                status:        'SUCCESS',
                newValues:     { on_chain_tx_hash: receipt.hash },
                ipAddress:     req.ip,
                userAgent:     req.get('user-agent'),
            });

            return res.json({ success: true, txHash: receipt.hash });
        } catch (err) {
            console.error('[MultiPartyEscrow] activate error:', err);
            return errorResponse(res, err.message, 500);
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/escrow/milestones/:escrowId/participants
// Add a participant to an escrow
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    '/:escrowId/participants',
    requireRole(['seller', 'admin']),
    async (req, res) => {
        const { escrowId }                     = req.params;
        const { walletAddress, role, userId, onChain } = req.body;

        if (!walletAddress || !role) {
            return errorResponse(res, 'walletAddress and role are required', 400);
        }

        try {
            const participant = await svc.addParticipant(escrowId, {
                walletAddress,
                role,
                userId: userId || null,
                onChain: !!onChain,
            });

            await logAudit({
                operationType: 'ESCROW_PARTICIPANT_ADD',
                entityType:    'ESCROW',
                entityId:      escrowId,
                actorId:       req.user.id,
                actorWallet:   req.user.wallet_address,
                actorRole:     req.user.role,
                action:        'CREATE',
                status:        'SUCCESS',
                newValues:     { wallet_address: walletAddress, role },
                ipAddress:     req.ip,
                userAgent:     req.get('user-agent'),
            });

            return res.status(201).json({ success: true, participant });
        } catch (err) {
            console.error('[MultiPartyEscrow] add-participant error:', err);
            if (err.code === '23505') {
                return errorResponse(res, 'Participant already exists in this escrow', 409);
            }
            return errorResponse(res, err.message, 500);
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/escrow/milestones/:escrowId/milestones
// Add a milestone to an existing escrow
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    '/:escrowId/milestones',
    requireRole(['seller', 'admin']),
    async (req, res) => {
        const { escrowId }                                              = req.params;
        const { title, description, amount, requiredApprovals, metadata, onChain } = req.body;

        if (!title || amount === undefined) {
            return errorResponse(res, 'title and amount are required', 400);
        }

        try {
            const milestone = await svc.createMilestone(escrowId, {
                title,
                description,
                amount,
                requiredApprovals,
                metadata,
                onChain: !!onChain,
            });

            await logAudit({
                operationType: 'ESCROW_MILESTONE_CREATE',
                entityType:    'MILESTONE',
                entityId:      String(milestone.id),
                actorId:       req.user.id,
                actorWallet:   req.user.wallet_address,
                actorRole:     req.user.role,
                action:        'CREATE',
                status:        'SUCCESS',
                newValues:     { title, amount },
                ipAddress:     req.ip,
                userAgent:     req.get('user-agent'),
            });

            return res.status(201).json({ success: true, milestone });
        } catch (err) {
            console.error('[MultiPartyEscrow] create-milestone error:', err);
            return errorResponse(res, err.message, 500);
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/escrow/milestones/:escrowId/milestones/:milestoneId/approve
// Approve a milestone (buyer / seller / supplier / admin)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    '/:escrowId/milestones/:milestoneId/approve',
    requireRole(['buyer', 'seller', 'supplier', 'admin']),
    async (req, res) => {
        const { escrowId, milestoneId }   = req.params;
        const { txHash, blockNumber }     = req.body;

        try {
            const updated = await svc.approveMilestone(req.params.escrowId, Number(milestoneId), {
                userId:        req.user.id,
                walletAddress: req.user.wallet_address,
                txHash,
                blockNumber,
            });

            const io = req.app.get('io');
            if (io) {
                emitToInvoice(io, escrowId, 'escrow:milestone:approved', {
                    escrowId,
                    milestoneId,
                    milestoneStatus: updated.status,
                    approvalCount:   updated.approval_count,
                });

                // Notify via user room so all stakeholder tabs refresh
                emitToUser(io, req.user.id, 'escrow:milestone:approved', {
                    escrowId, milestoneId,
                });
            }

            await logAudit({
                operationType: 'ESCROW_MILESTONE_APPROVE',
                entityType:    'MILESTONE',
                entityId:      milestoneId,
                actorId:       req.user.id,
                actorWallet:   req.user.wallet_address,
                actorRole:     req.user.role,
                action:        'UPDATE',
                status:        'SUCCESS',
                newValues:     { milestone_status: updated.status },
                ipAddress:     req.ip,
                userAgent:     req.get('user-agent'),
            });

            return res.json({ success: true, milestone: updated });
        } catch (err) {
            console.error('[MultiPartyEscrow] approve-milestone error:', err);
            if (err.code === '23505') {
                return errorResponse(res, 'You have already approved this milestone', 409);
            }
            return errorResponse(res, err.message, 500);
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/escrow/milestones/:escrowId
// Fetch full escrow details (header + participants + milestones with approvals)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
    '/:escrowId',
    requireRole(['buyer', 'seller', 'supplier', 'admin', 'investor']),
    async (req, res) => {
        try {
            const escrow = await svc.getEscrowDetails(req.params.escrowId);
            if (!escrow) return errorResponse(res, 'Escrow not found', 404);
            return res.json({ success: true, escrow });
        } catch (err) {
            console.error('[MultiPartyEscrow] get-details error:', err);
            return errorResponse(res, err.message, 500);
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/escrow/milestones/:escrowId/milestones
// Fetch only the milestones (and participants) for an escrow
// ─────────────────────────────────────────────────────────────────────────────
router.get(
    '/:escrowId/milestones',
    requireRole(['buyer', 'seller', 'supplier', 'admin', 'investor']),
    async (req, res) => {
        try {
            const escrow = await svc.getEscrowDetails(req.params.escrowId);
            if (!escrow) return errorResponse(res, 'Escrow not found', 404);
            return res.json({
                success:      true,
                milestones:   escrow.milestones,
                participants: escrow.participants,
                status:       escrow.status,
                totalAmount:  escrow.total_amount,
                releasedAmount: escrow.released_amount,
            });
        } catch (err) {
            console.error('[MultiPartyEscrow] get-milestones error:', err);
            return errorResponse(res, err.message, 500);
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/escrow/milestones
// List all multi-party escrows created by the authenticated user
// ─────────────────────────────────────────────────────────────────────────────
router.get(
    '/',
    requireRole(['buyer', 'seller', 'admin', 'investor']),
    async (req, res) => {
        try {
            const { status } = req.query;
            const escrows = await svc.listEscrowsByUser(req.user.id, status || null);
            return res.json({ success: true, escrows });
        } catch (err) {
            console.error('[MultiPartyEscrow] list error:', err);
            return errorResponse(res, err.message, 500);
        }
    }
);

module.exports = router;
