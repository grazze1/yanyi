import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from './SafeMarkdown';

describe('SafeMarkdown', () => {
  it('renders supported markdown without injecting raw HTML', () => {
    const { container } = render(
      <SafeMarkdown content={'## 解释\n\n**重点** 与 `tensor`\n\n<script>alert(1)</script>'} />,
    );

    expect(screen.getByRole('heading', { name: '解释' })).toBeInTheDocument();
    expect(screen.getByText('重点').tagName).toBe('STRONG');
    expect(screen.getByText('tensor').tagName).toBe('CODE');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
  });

  it('links only HTTP and HTTPS targets', () => {
    render(
      <SafeMarkdown
        content={'[安全链接](https://example.com/docs) [危险链接](javascript:alert(1))'}
      />,
    );

    expect(screen.getByRole('link', { name: '安全链接' })).toHaveAttribute(
      'href',
      'https://example.com/docs',
    );
    expect(screen.queryByRole('link', { name: '危险链接' })).toBeNull();
    expect(screen.getByText('危险链接')).toBeInTheDocument();
  });
});
