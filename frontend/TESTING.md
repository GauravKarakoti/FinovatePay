# Frontend Testing Guide

This guide covers the testing setup and best practices for the FinovatePay frontend.

## Testing Stack

- **Test Runner**: [Vitest](https://vitest.dev/) - Fast unit test framework powered by Vite
- **Component Testing**: [@testing-library/react](https://testing-library.com/react) - React Testing Library
- **User Interactions**: [@testing-library/user-event](https://testing-library.com/user-event) - Simulate user events
- **Assertions**: Built-in Vitest assertions and Jest DOM matchers
- **Coverage**: [@vitest/coverage-v8](https://vitest.dev/guide/coverage.html) - Code coverage reporting

## Running Tests

### Run all tests
```bash
npm run test
```

### Run tests in watch mode (re-run on file changes)
```bash
npm run test -- --watch
```

### Run tests with UI dashboard
```bash
npm run test:ui
```

### Run tests with coverage report
```bash
npm run test:coverage
```

### Run specific test file
```bash
npm run test -- src/test/example.test.js
```

### Run tests matching a pattern
```bash
npm run test -- --grep "Button"
```

## Test File Structure

Test files should be placed next to the component/utility they test or in the `src/test/` directory:

```
src/
├── components/
│   ├── Button.jsx
│   ├── Button.test.js
│   └── ...
├── utils/
│   ├── api.js
│   ├── api.test.js
│   └── ...
└── test/
    ├── setup.js          # Test environment setup
    ├── test-utils.js     # Custom test utilities
    ├── example.test.js   # Example tests
    └── components.test.js # Component test examples
```

## Writing Unit Tests

### Basic Unit Test
```javascript
import { describe, it, expect } from 'vitest';

describe('Math operations', () => {
  it('should add two numbers correctly', () => {
    const sum = 2 + 2;
    expect(sum).toBe(4);
  });

  it('should multiply two numbers correctly', () => {
    const product = 3 * 4;
    expect(product).toBe(12);
  });
});
```

## Writing Component Tests

### Testing React Components
```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from '../components/Button';

describe('Button Component', () => {
  it('should render button with text', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeInTheDocument();
  });

  it('should call onClick handler when clicked', async () => {
    const handleClick = vitest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    
    const button = screen.getByRole('button', { name: /click me/i });
    await userEvent.click(button);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should be disabled when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeDisabled();
  });
});
```

## Common Assertions

### Existence
```javascript
expect(element).toBeInTheDocument();
expect(element).toExist();
```

### Text/Content
```javascript
expect(element).toHaveTextContent('Expected text');
expect(element).toHaveValue('input value');
```

### Attributes
```javascript
expect(element).toHaveAttribute('href', '/path');
expect(element).toHaveClass('active');
```

### Visibility
```javascript
expect(element).toBeVisible();
expect(element).toBeInTheDocument();
```

### State
```javascript
expect(element).toBeDisabled();
expect(element).toBeEnabled();
expect(element).toBeChecked();
```

### Arrays/Objects
```javascript
expect(array).toHaveLength(3);
expect(array).toContain(value);
expect(object).toHaveProperty('name');
```

## Testing Async Operations

### Testing API Calls
```javascript
import { vi } from 'vitest';

it('should fetch data from API', async () => {
  const mockData = { id: 1, name: 'Test' };
  
  vi.spyOn(global, 'fetch').mockResolvedValue({
    json: async () => mockData
  });

  const response = await fetch('/api/data');
  const data = await response.json();
  
  expect(data).toEqual(mockData);
});
```

### Testing User Input
```javascript
import userEvent from '@testing-library/user-event';

it('should handle form submission', async () => {
  const user = userEvent.setup();
  render(<LoginForm onSubmit={handleSubmit} />);
  
  const emailInput = screen.getByLabelText('Email');
  const passwordInput = screen.getByLabelText('Password');
  const submitButton = screen.getByRole('button', { name: /login/i });
  
  await user.type(emailInput, 'test@example.com');
  await user.type(passwordInput, 'password123');
  await user.click(submitButton);
  
  expect(handleSubmit).toHaveBeenCalled();
});
```

## Mocking

### Mocking Functions
```javascript
import { vi } from 'vitest';

const mockFn = vi.fn();
mockFn('hello');
expect(mockFn).toHaveBeenCalledWith('hello');
```

### Mocking Modules
```javascript
vi.mock('../utils/api', () => ({
  fetchUser: vi.fn(() => Promise.resolve({ id: 1, name: 'John' }))
}));
```

## Best Practices

1. **Test Behavior, Not Implementation**
   - Test what your component does, not how it does it
   - Focus on user interactions and outcomes

2. **Use Semantic Queries**
   - Use `getByRole`, `getByLabelText`, `getByDisplayValue`
   - Avoid testing implementation details

3. **Keep Tests Focused**
   - One assertion per test case
   - Use clear, descriptive test names

4. **Avoid Testing Library Internals**
   - Don't test state directly
   - Test interactions and results

5. **Use Data Attributes When Needed**
   - For hard-to-select elements, use `data-testid`
   - Keep test IDs semantic: `data-testid="user-profile-card"`

6. **Clean Up After Tests**
   - Use cleanup utilities from `@testing-library/react`
   - Vitest automatically cleans up after each test

## Coverage Goals

- Aim for at least 80% code coverage
- Focus on critical paths and business logic
- Not all edge cases need to be tested

Run coverage: `npm run test:coverage`

## Troubleshooting

### Import Errors
- Ensure all imports use correct paths
- Check that components exist
- Verify module exports

### Async/Wait Issues
- Always `await` user events: `await userEvent.click(...)`
- Use `waitFor` for async state updates
- Use `screen.findByRole` for elements that appear asynchronously

### Element Not Found
- Use `screen.debug()` to see rendered DOM
- Verify element queries match actual element text
- Check for case sensitivity in queries

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library React Guide](https://testing-library.com/docs/react-testing-library/intro)
- [React Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
