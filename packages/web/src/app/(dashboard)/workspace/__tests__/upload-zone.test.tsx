import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadZone } from '../upload-zone';

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(),
}));

import { getAccessToken } from '@/lib/auth';

const mockGetAccessToken = getAccessToken as Mock;

function createMockXHR(options: { status?: number; onProgress?: boolean } = {}) {
  const { status = 200, onProgress = false } = options;
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const uploadListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  return {
    open: vi.fn(),
    send: vi.fn(function (this: { upload: { addEventListener: Mock } }) {
      if (onProgress) {
        uploadListeners['progress']?.forEach((fn) =>
          fn({ lengthComputable: true, loaded: 50, total: 100 }),
        );
      }
      setTimeout(() => {
        listeners['load']?.forEach((fn) => fn());
      }, 0);
    }),
    setRequestHeader: vi.fn(),
    status,
    upload: {
      addEventListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        uploadListeners[event] = uploadListeners[event] || [];
        uploadListeners[event].push(handler);
      }),
    },
    addEventListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    }),
  };
}

describe('UploadZone', () => {
  const defaultProps = {
    currentPath: '/documents',
    onUploadComplete: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  it('renders drop zone with instructions', () => {
    render(<UploadZone {...defaultProps} />);

    expect(screen.getByText(/Drop files here/)).toBeInTheDocument();
    expect(screen.getByText('browse files')).toBeInTheDocument();
    expect(screen.getByText('upload folder')).toBeInTheDocument();
  });

  it('displays max file size', () => {
    render(<UploadZone {...defaultProps} />);

    expect(screen.getByText(/Max file size:/)).toBeInTheDocument();
    expect(screen.getByText(/50.*MB/)).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<UploadZone {...defaultProps} />);

    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(<UploadZone {...defaultProps} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('applies drag-over styling on dragover', () => {
    render(<UploadZone {...defaultProps} />);

    const dropZone = screen.getByText(/Drop files here/).parentElement!;
    expect(dropZone).not.toHaveClass('border-amber-500');

    fireEvent.dragOver(dropZone);

    expect(dropZone).toHaveClass('border-amber-500');
  });

  it('removes drag-over styling on dragleave', () => {
    render(<UploadZone {...defaultProps} />);

    const dropZone = screen.getByText(/Drop files here/).parentElement!;

    fireEvent.dragOver(dropZone);
    expect(dropZone).toHaveClass('border-amber-500');

    fireEvent.dragLeave(dropZone);
    expect(dropZone).not.toHaveClass('border-amber-500');
  });

  it('shows error when file exceeds size limit', async () => {
    const mockXHR = createMockXHR();
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => mockXHR),
    );

    render(<UploadZone {...defaultProps} />);

    const largeFile = new File(['x'.repeat(60 * 1024 * 1024)], 'large.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])');

    Object.defineProperty(input, 'files', { value: [largeFile], configurable: true });
    fireEvent.change(input!);

    await waitFor(() => {
      expect(screen.getByText(/exceeds.*limit/i)).toBeInTheDocument();
    });
  });

  it('shows error when not authenticated', async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const mockXHR = createMockXHR();
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => mockXHR),
    );

    render(<UploadZone {...defaultProps} />);

    const file = new File(['test'], 'test.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input!);

    await waitFor(() => {
      expect(screen.getByText('Not authenticated')).toBeInTheDocument();
    });
  });

  it('uploads file and shows success', async () => {
    const onUploadComplete = vi.fn();
    const mockXHR = createMockXHR({ status: 201 });
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => mockXHR),
    );

    render(<UploadZone {...defaultProps} onUploadComplete={onUploadComplete} />);

    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input!);

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeInTheDocument();
    });

    expect(onUploadComplete).toHaveBeenCalled();
    expect(mockXHR.open).toHaveBeenCalledWith(
      'POST',
      expect.stringContaining('/api/v1/workspace/files/upload'),
    );
    expect(mockXHR.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-token');
  });

  it('shows error on 409 conflict', async () => {
    const mockXHR = createMockXHR({ status: 409 });
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => mockXHR),
    );

    render(<UploadZone {...defaultProps} />);

    const file = new File(['test'], 'existing.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input!);

    await waitFor(() => {
      expect(screen.getByText('File already exists')).toBeInTheDocument();
    });
  });

  it('shows error on upload failure', async () => {
    const mockXHR = createMockXHR({ status: 500 });
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => mockXHR),
    );

    render(<UploadZone {...defaultProps} />);

    const file = new File(['test'], 'test.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input!);

    await waitFor(() => {
      expect(screen.getByText('Upload failed (500)')).toBeInTheDocument();
    });
  });

  it('displays file name and size in upload list', async () => {
    const mockXHR = createMockXHR({ status: 201 });
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => mockXHR),
    );

    render(<UploadZone {...defaultProps} />);

    const file = new File(['test content'], 'myfile.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input!);

    await waitFor(() => {
      expect(screen.getByText('myfile.txt')).toBeInTheDocument();
    });
  });

  it('handles multiple files', async () => {
    const onUploadComplete = vi.fn();
    const mockXHR = createMockXHR({ status: 201 });
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => mockXHR),
    );

    render(<UploadZone {...defaultProps} onUploadComplete={onUploadComplete} />);

    const files = [
      new File(['content1'], 'file1.txt', { type: 'text/plain' }),
      new File(['content2'], 'file2.txt', { type: 'text/plain' }),
    ];
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])');

    Object.defineProperty(input, 'files', { value: files, configurable: true });
    fireEvent.change(input!);

    await waitFor(() => {
      expect(screen.getByText('file1.txt')).toBeInTheDocument();
      expect(screen.getByText('file2.txt')).toBeInTheDocument();
    });
  });

  it('clears file input after selection', async () => {
    const mockXHR = createMockXHR({ status: 201 });
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => mockXHR),
    );

    render(<UploadZone {...defaultProps} />);

    const file = new File(['test'], 'test.txt', { type: 'text/plain' });
    const input = document.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement;

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });
});
