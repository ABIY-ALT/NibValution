import { MapPinCheck, MapPinned, MapPinOff, MapPinX, Satellite } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { SiteVisitCheck } from '@/server/domain/shared/enums';
import { formatDistance, type VisitSummary } from '@/server/domain/site-visit/location-check';

/**
 * How a site check-in is shown wherever a visit appears: the valuation
 * workspace's visit log, the case page, and the signed report. One table, so
 * the maker, the checker and the approvers read the same verdict in the same
 * words.
 */

const CHECKS: Record<
  SiteVisitCheck,
  {
    label: (distance: string | null) => string;
    variant: 'success' | 'danger' | 'warning' | 'info';
    icon: typeof MapPinCheck;
    explain: string;
  }
> = {
  VERIFIED: {
    label: () => 'Verified on site',
    variant: 'success',
    icon: MapPinCheck,
    explain: 'The phone was at the property when the visit was recorded.',
  },
  OUTSIDE_RADIUS: {
    label: (distance) => (distance ? `${distance} from the property` : 'Away from the property'),
    variant: 'danger',
    icon: MapPinX,
    explain: 'The phone was further from the property than the allowed radius.',
  },
  LOW_ACCURACY: {
    label: () => 'Low GPS accuracy',
    variant: 'warning',
    icon: Satellite,
    explain: 'The phone’s position was too vague to confirm the visit.',
  },
  LOCATION_SET: {
    label: () => 'Located the property',
    variant: 'info',
    icon: MapPinned,
    explain:
      'The property had no coordinates, so this check-in set them. Confirm on the map that they match the address.',
  },
  NO_LOCATION: {
    label: () => 'No location captured',
    variant: 'warning',
    icon: MapPinOff,
    explain: 'The visit was recorded without the phone’s position, so it is not verified.',
  },
};

export function siteVisitCheckExplanation(check: SiteVisitCheck): string {
  return CHECKS[check].explain;
}

export function SiteVisitCheckBadge({
  check,
  distanceMeters,
}: {
  check: SiteVisitCheck;
  distanceMeters: string | null;
}) {
  const spec = CHECKS[check];
  const Icon = spec.icon;
  return (
    <Badge variant={spec.variant} title={spec.explain} className="gap-1">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {spec.label(distanceMeters !== null ? formatDistance(distanceMeters) : null)}
    </Badge>
  );
}

/** A Google Maps link to one point, opened outside the application. */
export function mapUrl(latitude: string, longitude: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

/** A caption for where a site photo was taken, and whether that is a concern. */
export function photoLocation(
  check: SiteVisitCheck | null,
  distanceMeters: string | null,
  accuracyMeters: string | null,
): { text: string; flagged: boolean } {
  switch (check) {
    case 'VERIFIED':
      return {
        text: distanceMeters ? `On site, ${formatDistance(distanceMeters)} away` : 'On site',
        flagged: false,
      };
    case 'OUTSIDE_RADIUS':
      return {
        text: distanceMeters
          ? `${formatDistance(distanceMeters)} from the property`
          : 'Away from the property',
        flagged: true,
      };
    case 'LOW_ACCURACY':
      return {
        text: accuracyMeters
          ? `GPS too vague (±${Math.round(Number(accuracyMeters))} m)`
          : 'GPS too vague',
        flagged: true,
      };
    case 'NO_LOCATION':
      return { text: 'No location captured', flagged: true };
    default:
      return { text: 'Location recorded', flagged: false };
  }
}

/** A stored site photo, shown inline; the route authorises and audits each fetch. */
export function photoUrl(documentId: string): string {
  return `/api/documents/${documentId}/download?view=1`;
}

/** The case list's one-word summary of a case's visits. */
export function VisitSummaryBadge({ summary }: { summary: VisitSummary }) {
  return summary === 'VERIFIED' ? (
    <Badge variant="success" className="gap-1">
      <MapPinCheck className="h-3 w-3" aria-hidden="true" />
      Verified
    </Badge>
  ) : summary === 'FLAGGED' ? (
    <Badge
      variant="danger"
      className="gap-1"
      title="Visits recorded, none verified at the property"
    >
      <MapPinX className="h-3 w-3" aria-hidden="true" />
      Flagged
    </Badge>
  ) : (
    <Badge variant="warning" className="gap-1">
      <MapPinOff className="h-3 w-3" aria-hidden="true" />
      Not visited
    </Badge>
  );
}
