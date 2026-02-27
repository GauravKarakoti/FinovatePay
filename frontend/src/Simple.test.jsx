import { render, screen } from '@testing-library/react'
import React from 'react'

// Simple component to verify test infrastructure works
function Simple() {
  return <div>Finovate Test Verified</div>
}

test('renders simple component', () => {
  render(<Simple />)
  expect(screen.getByText(/Finovate Test Verified/i)).toBeInTheDocument()
})
