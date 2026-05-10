import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility for merging tailwind classes with logic
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Design Tokens - Locked per spec
 */
export const tokens = {
  colors: {
    navy: { 
      900: '#0B1F3A', 
      800: '#0F2747', 
      700: '#16315A', 
      50: '#EEF2F8' 
    },
    ink: { 
      900: '#0A0E14', 
      800: '#10151D', 
      700: '#161C26' 
    },
    blue: { 
      600: '#0D6EFD', 
      500: '#2A82FF' 
    },
    teal: { 
      600: '#0891B2' 
    },
    green: { 
      600: '#0F9D58' 
    },
    emerald: { 
      700: '#047857', 
      400: '#34D399' 
    },
    amber: { 
      700: '#B45309', 
      500: '#F59E0B' 
    },
    red: { 
      600: '#D93025', 
      500: '#EF4444' 
    },
    gray: { 
      900: '#1F2937', 
      700: '#3D4757', 
      500: '#6B7280', 
      200: '#E5E7EB', 
      50: '#FAFAFA' 
    }
  },
  radii: { 
    sm: '6px', 
    md: '10px', 
    lg: '16px', 
    xl: '24px', 
    pill: '999px' 
  },
  motion: {
    fast: 0.15,
    base: 0.22,
    slow: 0.38,
    ease: [0.2, 0.8, 0.2, 1]
  }
};
