import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock @uiw/react-codemirror since it requires DOM APIs not available in jsdom
vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (val: string) => void }) => (
    <textarea
      data-testid="codemirror-mock"
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  ),
}));

vi.mock('@codemirror/lang-javascript', () => ({ javascript: () => [] }));
vi.mock('@codemirror/lang-json', () => ({ json: () => [] }));
vi.mock('@codemirror/lang-markdown', () => ({ markdown: () => [] }));
vi.mock('@codemirror/lang-css', () => ({ css: () => [] }));
vi.mock('@codemirror/lang-html', () => ({ html: () => [] }));
vi.mock('@codemirror/lang-python', () => ({ python: () => [] }));

import { FileEditor } from '../file-editor';
import type { FileContent } from '@clawix/shared';

const mockFile: FileContent = {
  path: '/config.ts',
  name: 'config.ts',
  size: 50,
  modifiedAt: '2026-01-01T00:00:00.000Z',
  type: 'code',
  content: 'const x = 1;',
  truncated: false,
};

describe('FileEditor', () => {
  it('renders the editor with file content', () => {
    render(<FileEditor file={mockFile} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('codemirror-mock')).toHaveValue('const x = 1;');
  });

  it('shows filename in header', () => {
    render(<FileEditor file={mockFile} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('config.ts')).toBeInTheDocument();
  });

  it('Save button is disabled when content is unchanged', () => {
    render(<FileEditor file={mockFile} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('Save button is enabled after editing', async () => {
    render(<FileEditor file={mockFile} onSave={vi.fn()} onCancel={vi.fn()} />);
    const editor = screen.getByTestId('codemirror-mock');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'const x = 2;');
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });

  it('calls onSave with updated content', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FileEditor file={mockFile} onSave={onSave} onCancel={vi.fn()} />);
    const editor = screen.getByTestId('codemirror-mock');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'new content');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith('new content');
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    render(<FileEditor file={mockFile} onSave={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('reports dirty state via onDirtyChange', async () => {
    const onDirtyChange = vi.fn();
    render(
      <FileEditor
        file={mockFile}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    const editor = screen.getByTestId('codemirror-mock');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'changed');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
});
