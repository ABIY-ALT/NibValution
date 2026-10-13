'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Opens the browser's print dialog, where "Save as PDF" produces the file. */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer aria-hidden="true" />
      Print / save as PDF
    </Button>
  );
}
