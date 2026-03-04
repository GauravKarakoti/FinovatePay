import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Example React component test file
 * This demonstrates how to test React components
 */

// Example component for testing
const Button = ({ onClick, label = 'Click me' }) => (
  <button onClick={onClick}>{label}</button>
);

describe('Button Component', () => {
  it('should render the button with label', () => {
    render(<Button label="Test Button" />);
    const button = screen.getByRole('button', { name: /test button/i });
    expect(button).toBeInTheDocument();
  });

  it('should handle click events', async () => {
    const handleClick = () => {
      // Mock function
    };
    
    render(<Button onClick={handleClick} label="Click me" />);
    const button = screen.getByRole('button', { name: /click me/i });
    
    expect(button).toBeInTheDocument();
  });

  it('should render with default label', () => {
    render(<Button />);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeInTheDocument();
  });
});

/**
 * Example Input component test
 */
const Input = ({ placeholder, value, onChange }) => (
  <input
    placeholder={placeholder}
    value={value}
    onChange={onChange}
  />
);

describe('Input Component', () => {
  it('should render input with placeholder', () => {
    render(<Input placeholder="Enter text" />);
    const input = screen.getByPlaceholderText('Enter text');
    expect(input).toBeInTheDocument();
  });

  it('should handle text input', async () => {
    const user = userEvent.setup();
    const handleChange = () => {};
    
    render(
      <Input
        placeholder="Enter text"
        onChange={handleChange}
      />
    );
    
    const input = screen.getByPlaceholderText('Enter text');
    await user.type(input, 'hello');
    
    expect(input.value).toBe('hello');
  });
});
