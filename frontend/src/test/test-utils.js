import { render } from '@testing-library/react';

/**
 * Custom render function wrapper
 * Use this instead of @testing-library/react render for consistent test setup
 * Add providers (Redux, React Router, etc.) here
 */
export const customRender = (
  ui,
  options = {}
) => {
  // Add any providers here if needed
  // Example: React Router, Redux, etc.
  return render(ui, { ...options });
};

// Re-export everything from @testing-library/react
export * from '@testing-library/react';

// Override the default render with our custom one
export { customRender as render };
