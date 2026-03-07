import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusTimeline from '../components/StatusTimeline';

describe('StatusTimeline', () => {
  it('renders all four steps', () => {
    render(<StatusTimeline currentStatus="draft" />);
    
    expect(screen.getByText('Draft Created')).toBeInTheDocument();
    expect(screen.getByText('Signed (On-Chain)')).toBeInTheDocument();
    expect(screen.getByText('Escrow Funded')).toBeInTheDocument();
    expect(screen.getByText('Funds Released')).toBeInTheDocument();
  });

  it('marks current step as active when status is draft', () => {
    render(<StatusTimeline currentStatus="draft" />);
    
    // First step should be current
    const stepNumbers = screen.getAllByText('1');
    expect(stepNumbers.length).toBeGreaterThan(0);
  });

  it('shows checkmark for completed steps', () => {
    render(<StatusTimeline currentStatus="funded" />);
    
    // When status is 'funded', steps 'draft' and 'signed' should be complete
    const checkmarks = screen.getAllByText('✓');
    expect(checkmarks.length).toBe(2); // draft and signed are complete
  });

  it('shows all steps as complete when status is complete', () => {
    render(<StatusTimeline currentStatus="complete" />);
    
    // All steps should have checkmarks
    const checkmarks = screen.getAllByText('✓');
    expect(checkmarks.length).toBe(4);
  });

  it('handles uppercase status input', () => {
    render(<StatusTimeline currentStatus="FUNDED" />);
    
    // Should still work with uppercase input
    const checkmarks = screen.getAllByText('✓');
    expect(checkmarks.length).toBe(2);
  });

  it('handles mixed case status input', () => {
    render(<StatusTimeline currentStatus="Signed" />);
    
    // Should still work with mixed case input
    const checkmarks = screen.getAllByText('✓');
    expect(checkmarks.length).toBe(1); // Only draft is complete
  });

  it('renders with proper structure', () => {
    const { container } = render(<StatusTimeline currentStatus="draft" />);
    
    // Should have the timeline container
    const timeline = container.querySelector('.flex.items-center.justify-between');
    expect(timeline).toBeInTheDocument();
  });
});
