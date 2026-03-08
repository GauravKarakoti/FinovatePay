import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EarlyPaymentCard from '../components/EarlyPaymentCard';

// Mock the API module
vi.mock('../utils/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { api } from '../utils/api';

describe('EarlyPaymentCard Component', () => {
  const mockInvoiceId = 'test-invoice-123';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location.reload
    Object.defineProperty(window, 'location', {
      value: { reload: vi.fn() },
      writable: true,
    });
  });

  it('shows loading state initially', () => {
    api.get.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(<EarlyPaymentCard invoiceId={mockInvoiceId} />);
    
    expect(screen.getByText(/checking for offers/i)).toBeInTheDocument();
  });

  it('fetches offer data on mount', async () => {
    const mockOffer = {
      eligible: true,
      originalAmount: 1000,
      discountAmount: 50,
      finalAmount: 950,
      daysEarly: 30,
      apr: 18,
    };
    api.get.mockResolvedValue({ data: mockOffer });
    
    render(<EarlyPaymentCard invoiceId={mockInvoiceId} />);
    
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(`/invoices/${mockInvoiceId}/offer`);
    });
  });

  it('renders offer card when eligible', async () => {
    const mockOffer = {
      eligible: true,
      originalAmount: 1000,
      discountAmount: 50,
      finalAmount: 950,
      daysEarly: 30,
      apr: 18,
    };
    api.get.mockResolvedValue({ data: mockOffer });
    
    render(<EarlyPaymentCard invoiceId={mockInvoiceId} />);
    
    await waitFor(() => {
      expect(screen.getByText(/get paid early/i)).toBeInTheDocument();
      expect(screen.getByText(/\$50/)).toBeInTheDocument();
      expect(screen.getByText(/\$950/)).toBeInTheDocument();
      expect(screen.getByText(/30 days early/i)).toBeInTheDocument();
      expect(screen.getByText(/18%/)).toBeInTheDocument();
    });
  });

  it('does not render when not eligible', async () => {
    const mockOffer = {
      eligible: false,
    };
    api.get.mockResolvedValue({ data: mockOffer });
    
    const { container } = render(<EarlyPaymentCard invoiceId={mockInvoiceId} />);
    
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('does not render when offer is null', async () => {
    api.get.mockResolvedValue({ data: null });
    
    const { container } = render(<EarlyPaymentCard invoiceId={mockInvoiceId} />);
    
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('handles API error gracefully', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.get.mockRejectedValue(new Error('Network error'));
    
    const { container } = render(<EarlyPaymentCard invoiceId={mockInvoiceId} />);
    
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Error fetching offer', expect.any(Error));
    });
    
    // Should not render anything on error
    expect(container.firstChild).toBeNull();
    consoleError.mockRestore();
  });

  it('calls accept offer API when button is clicked', async () => {
    const mockOffer = {
      eligible: true,
      originalAmount: 1000,
      discountAmount: 50,
      finalAmount: 950,
      daysEarly: 30,
      apr: 18,
    };
    api.get.mockResolvedValue({ data: mockOffer });
    api.post.mockResolvedValue({ data: { success: true } });
    
    render(<EarlyPaymentCard invoiceId={mockInvoiceId} />);
    
    await waitFor(() => {
      expect(screen.getByText(/accept offer/i)).toBeInTheDocument();
    });
    
    const acceptButton = screen.getByText(/accept offer/i);
    fireEvent.click(acceptButton);
    
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(`/invoices/${mockInvoiceId}/settle-early`);
    });
  });

  it('reloads page after successful acceptance', async () => {
    const mockOffer = {
      eligible: true,
      originalAmount: 1000,
      discountAmount: 50,
      finalAmount: 950,
      daysEarly: 30,
      apr: 18,
    };
    api.get.mockResolvedValue({ data: mockOffer });
    api.post.mockResolvedValue({ data: { success: true } });
    
    render(<EarlyPaymentCard invoiceId={mockInvoiceId} />);
    
    await waitFor(() => {
      expect(screen.getByText(/accept offer/i)).toBeInTheDocument();
    });
    
    const acceptButton = screen.getByText(/accept offer/i);
    fireEvent.click(acceptButton);
    
    await waitFor(() => {
      expect(window.location.reload).toHaveBeenCalled();
    });
  });
});
