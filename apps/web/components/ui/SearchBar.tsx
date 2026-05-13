'use client';

import React, { useState } from 'react';
import { Search, Command } from 'lucide-react';

interface SearchBarProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
}

export function SearchBar({ onSearch, placeholder }: SearchBarProps) {
  const [query, setQuery] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    onSearch?.(value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(query);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative flex w-full max-w-3xl items-center group"
    >
      {/* Outer glow */}
      <div className="absolute -inset-[1px] bg-gradient-to-r from-transparent via-[#7DD3FC]/20 to-transparent rounded-lg opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 blur-sm" />

      <div className="relative flex w-full items-center">
        {/* Left icon */}
        <div className="absolute inset-y-0 left-0 flex items-center pl-5 pointer-events-none">
          <Search className="w-4 h-4 text-[#7DD3FC]/40 group-focus-within:text-[#7DD3FC] transition-colors" />
        </div>

        <input
          type="search"
          value={query}
          onChange={handleChange}
          className="block w-full py-4 pl-13 pr-36 text-sm font-mono text-[#f8fafc] bg-[#0a0f1c] border border-[#7DD3FC]/15 rounded-lg focus:border-[#7DD3FC]/40 focus:outline-none placeholder-[#f8fafc]/20 transition-all duration-300 focus:shadow-[0_0_30px_rgba(125, 211, 252,0.06)]"
          placeholder={placeholder || "Search the registry..."}
        />

        {/* Keyboard shortcut hint */}
        <div className="absolute right-28 inset-y-0 flex items-center pointer-events-none">
          <div className="flex items-center gap-1 text-[#f8fafc]/15">
            <Command className="w-3 h-3" />
            <span className="text-[10px] font-mono">K</span>
          </div>
        </div>

        {/* Search button */}
        <button
          type="submit"
          className="absolute right-1.5 bottom-1.5 top-1.5 px-6 font-mono text-xs font-bold tracking-wider uppercase text-[#060a13] bg-[#7DD3FC] rounded-md hover:bg-[#BAE6FD] transition-all duration-200 hover:shadow-[0_0_20px_rgba(125, 211, 252,0.3)]"
        >
          Search
        </button>
      </div>
    </form>
  );
}
