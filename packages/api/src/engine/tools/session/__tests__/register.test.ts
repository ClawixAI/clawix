import { describe, it, expect } from 'vitest';
import { registerSessionTools } from '../register.js';

function makeRegistry() {
  const names: string[] = [];
  return { names, register: (t: { name: string }) => names.push(t.name) };
}

describe('registerSessionTools', () => {
  it('registers session_search', () => {
    const reg = makeRegistry();
    registerSessionTools(reg as never, { searchService: {} as never }, 'u1');
    expect(reg.names).toEqual(['session_search']);
  });
});
