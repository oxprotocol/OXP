import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-mono font-bold transition-all duration-300 focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none';

  const variants = {
    primary: 'bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] hover:shadow-[0_0_20px_rgba(125, 211, 252,0.3)] px-5 py-2 rounded',
    secondary: 'bg-transparent text-[#f8fafc]/70 border border-[#7DD3FC]/20 hover:border-[#7DD3FC]/50 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5 px-5 py-2 rounded',
    ghost: 'text-[#f8fafc]/50 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5 px-4 py-2 rounded',
  };

  return (
    <button className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
