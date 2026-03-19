'use client';

import { useState, useEffect } from 'react';

export default function SafeImage({ src, alt, className }: { src: string, alt: string, className?: string }) {
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  useEffect(() => {
    if (!src) return;
    
    // Reset state when a completely new source URL (different location) is passed
    setCurrentSrc(null);
    
    // Add small random delay for jitter (0 - 400ms) to avoid request bursts
    // If it's a retry, add exponential backoff (1s, 2s, 4s, etc)
    const delay = errorCount === 0 ? Math.random() * 400 : Math.pow(2, errorCount - 1) * 1000 + Math.random() * 500;
    
    const timer = setTimeout(() => {
      // Append a unique retry parameter to bypass browser caching for the failed 429 image
      setCurrentSrc(`${src}&retry=${errorCount}`); 
    }, delay);

    return () => clearTimeout(timer);
  }, [src, errorCount]);

  if (!currentSrc) {
    return (
      <div className={`animate-pulse bg-slate-700 flex items-center justify-center ${className || ''}`}>
        <span className="text-slate-500 text-xs font-bold uppercase tracking-widest">Loading...</span>
      </div>
    );
  }

  return (
    <img 
      src={currentSrc} 
      alt={alt} 
      className={className} 
      onError={() => {
        // If Google Maps API returns 429 Too Many Requests, it triggers onError
        // because we passed return_error_code=true in the API URL.
        console.warn(`[SafeImage] Failed to load image due to potential rate limits. Retrying... (Attempt ${errorCount + 1})`);
        if (errorCount < 5) {
          setErrorCount(prev => prev + 1);
          setCurrentSrc(null); // Triggers the useEffect to wait and try again
        } else {
          console.error(`[SafeImage] Exhausted retries for image.`);
        }
      }} 
    />
  );
}