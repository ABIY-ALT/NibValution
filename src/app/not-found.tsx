import Link from 'next/link';
import { NibLogo } from '@/components/nib-logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <NibLogo />
      <div>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          The page does not exist, or you are not authorised to see it. If you followed a link from
          within the system, please report it.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
