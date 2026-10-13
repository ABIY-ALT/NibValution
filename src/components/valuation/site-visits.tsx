'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Crosshair, ExternalLink, LocateFixed, MapPinCheck, MapPinOff } from 'lucide-react';
import { recordSiteVisitAction } from '@/server/actions/valuation-actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SiteVisitCheck } from '@/server/domain/shared/enums';
import { ActionMessage, INITIAL_STATE, SpecFields, SubmitButton } from './form-bits';
import {
  SiteVisitCheckBadge,
  mapUrl,
  photoLocation,
  photoUrl,
  siteVisitCheckExplanation,
} from './site-visit-check';

export interface SiteVisitRow {
  id: string;
  visitedAt: string;
  visitedBy: string;
  accessGained: boolean;
  findings: string | null;
  remarks: string | null;
  check: SiteVisitCheck;
  latitude: string | null;
  longitude: string | null;
  accuracyMeters: string | null;
  distanceMeters: string | null;
  canAddPhotos: boolean;
  photos: SitePhotoRow[];
}

export interface SitePhotoRow {
  id: string;
  takenAt: string;
  /** False until the photo has passed the malware scan. */
  viewable: boolean;
  check: SiteVisitCheck | null;
  latitude: string | null;
  longitude: string | null;
  accuracyMeters: string | null;
  distanceMeters: string | null;
}

type Capture =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'captured'; latitude: number; longitude: number; accuracy: number }
  | { status: 'failed'; message: string };

const STAMP = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const GEOLOCATION_ERRORS: Record<number, string> = {
  1: 'Location permission was refused. Allow location for this site in the browser settings, then try again.',
  2: 'The phone could not get a GPS fix. Move outdoors and try again.',
  3: 'Getting a GPS fix took too long. Move outdoors and try again.',
};

/** The phone's current position, or null if it cannot be had. Never rejects. */
function currentPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 30_000,
      maximumAge: 15_000,
    });
  });
}

/** The longest edge a site photo is sent at: plenty for a report, light on mobile data. */
const PHOTO_MAX_EDGE = 2048;

/**
 * Shrink a camera photo before it is sent. A phone photo is often 4-8 MB, which
 * is slow over mobile data at a remote site. Falls back to the original file
 * whenever the browser cannot re-encode it.
 */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * A visit's photos, and - for the valuator who made the visit - the camera.
 *
 * The phone starts finding its position when the camera opens, so the fix is
 * ready by the time the photo is taken. The position goes with the photo and
 * is judged on the server against the property, like the check-in.
 */
function VisitPhotos({
  caseId,
  visitId,
  photos,
  canAdd,
}: {
  caseId: string;
  visitId: string;
  photos: SitePhotoRow[];
  canAdd: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const warmFix = useRef<Promise<GeolocationPosition | null> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  function openCamera() {
    setError(null);
    warmFix.current = currentPosition();
    input.current?.click();
  }

  async function send(file: File) {
    setStatus('Finding your location…');
    try {
      const position = (await warmFix.current) ?? (await currentPosition());
      setStatus('Uploading photo…');
      const image = await shrinkPhoto(file);
      const form = new FormData();
      form.set('caseId', caseId);
      form.set('categoryCode', 'SITE_PHOTO');
      form.set('siteVisitId', visitId);
      if (position) {
        form.set('latitude', String(position.coords.latitude));
        form.set('longitude', String(position.coords.longitude));
        form.set('accuracyMeters', String(position.coords.accuracy));
      }
      const name = image === file ? file.name : `site-photo-${Date.now()}.jpg`;
      form.append('file', image, name);

      const response = await fetch('/api/documents/upload', { method: 'POST', body: form });
      const body = (await response.json().catch(() => null)) as {
        detail?: string;
        rejected?: { reason: string }[];
      } | null;
      if (!response.ok) {
        setError(body?.rejected?.[0]?.reason ?? body?.detail ?? 'The photo could not be uploaded.');
      } else if (!position) {
        setError('Uploaded without a location - the phone could not get a GPS fix.');
      }
      startTransition(() => router.refresh());
    } catch {
      setError('The photo could not be uploaded. Check the connection and try again.');
    } finally {
      setStatus(null);
      warmFix.current = null;
    }
  }

  if (photos.length === 0 && !canAdd) return null;
  const busy = status !== null || isRefreshing;

  return (
    <div className="space-y-2 pt-1">
      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => {
            const where = photoLocation(photo.check, photo.distanceMeters, photo.accuracyMeters);
            return (
              <li key={photo.id} className="min-w-0">
                {photo.viewable ? (
                  <a href={photoUrl(photo.id)} target="_blank" rel="noopener noreferrer">
                    {/* An authorised API route, not a static asset next/image could optimise. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrl(photo.id)}
                      alt={`Site photograph taken ${STAMP.format(new Date(photo.takenAt))}`}
                      loading="lazy"
                      className="aspect-square w-full rounded-sm bg-surface-3 object-cover"
                    />
                  </a>
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-sm bg-surface-3 p-1 text-center text-[10.5px] text-ink-3">
                    Awaiting malware scan
                  </div>
                )}
                <p
                  className={cn(
                    'mt-0.5 truncate text-[10.5px]',
                    where.flagged ? 'font-semibold text-st-late' : 'text-ink-3',
                  )}
                  title={where.text}
                >
                  {where.text}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}

      {canAdd ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void send(file);
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={openCamera} disabled={busy}>
            <Camera aria-hidden="true" />
            {status ?? 'Take photo'}
          </Button>
          {error ? (
            <p role="alert" className="text-[11.5px] text-st-late">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The site-visit log, and the check-in that records a visit.
 *
 * A visit is recorded from the property: the valuator captures the phone's
 * position, and the server stamps the time and judges the position against the
 * property's location. A visit where access was refused is recorded the same
 * way - checked in at the gate, it is the evidence behind "not visited".
 */
export function SiteVisits({
  caseId,
  visits,
  canRecord,
  property,
  maxAccuracyMeters,
}: {
  caseId: string;
  visits: SiteVisitRow[];
  canRecord: boolean;
  /** The property's coordinates, when it has them. */
  property: { latitude: string; longitude: string } | null;
  maxAccuracyMeters: number;
}) {
  const [capture, setCapture] = useState<Capture>({ status: 'idle' });
  const [state, formAction] = useActionState(
    async (previous: typeof INITIAL_STATE, formData: FormData) => {
      const result = await recordSiteVisitAction(previous, formData);
      // A position belongs to one visit; the next one is captured afresh.
      if (result.ok) setCapture({ status: 'idle' });
      return result;
    },
    INITIAL_STATE,
  );

  function locate() {
    if (!('geolocation' in navigator)) {
      setCapture({ status: 'failed', message: 'This browser cannot share its location.' });
      return;
    }
    setCapture({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setCapture({
          status: 'captured',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) =>
        setCapture({
          status: 'failed',
          message: GEOLOCATION_ERRORS[error.code] ?? 'The location could not be captured.',
        }),
      // A fresh, precise fix: a cached position could be from somewhere else.
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
    );
  }

  const captured = capture.status === 'captured' ? capture : null;
  const locationError = state.fieldErrors?.latitude?.[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-3">
        {property ? (
          <a
            href={mapUrl(property.latitude, property.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            Property location on the map
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : (
          <p className="text-[12px] text-ink-3">
            The property has no coordinates yet. The first precise check-in sets them.
          </p>
        )}

        {visits.length === 0 ? (
          <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
            No site visit recorded yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {visits.map((visit) => {
              const Icon = visit.accessGained ? MapPinCheck : MapPinOff;
              return (
                <li
                  key={visit.id}
                  className="flex gap-3 rounded-(--radius-control) bg-surface-2 p-3.5"
                >
                  <span
                    aria-hidden="true"
                    className={
                      visit.accessGained
                        ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-st-done-bg text-st-done'
                        : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-st-late-bg text-st-late'
                    }
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="text-[13px] font-semibold text-ink">
                      {STAMP.format(new Date(visit.visitedAt))} ·{' '}
                      {visit.accessGained ? 'Inspected' : 'No access'}
                    </p>
                    <p className="text-[12px] text-ink-3">{visit.visitedBy}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <SiteVisitCheckBadge
                        check={visit.check}
                        distanceMeters={visit.distanceMeters}
                      />
                      {visit.accuracyMeters ? (
                        <span className="text-[11.5px] text-ink-3">
                          GPS ±{Math.round(Number(visit.accuracyMeters))} m
                        </span>
                      ) : null}
                      {visit.latitude && visit.longitude ? (
                        <a
                          href={mapUrl(visit.latitude, visit.longitude)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
                        >
                          Check-in on the map
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                    {visit.check !== 'VERIFIED' ? (
                      <p className="text-[11.5px] text-ink-3">
                        {siteVisitCheckExplanation(visit.check)}
                      </p>
                    ) : null}
                    {visit.findings ? (
                      <p className="whitespace-pre-line text-[12.5px] text-ink-2 wrap-anywhere">
                        {visit.findings}
                      </p>
                    ) : null}
                    {visit.remarks ? (
                      <p className="text-[12px] text-ink-3 wrap-anywhere">{visit.remarks}</p>
                    ) : null}
                    <VisitPhotos
                      caseId={caseId}
                      visitId={visit.id}
                      photos={visit.photos}
                      canAdd={visit.canAddPhotos}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {canRecord ? (
        <form
          action={formAction}
          className="space-y-4 rounded-(--radius-control) border border-line p-4"
          noValidate
        >
          <p className="text-[13px] font-semibold text-ink">Check in at the property</p>
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="latitude" value={captured ? String(captured.latitude) : ''} />
          <input
            type="hidden"
            name="longitude"
            value={captured ? String(captured.longitude) : ''}
          />
          <input
            type="hidden"
            name="accuracyMeters"
            value={captured ? String(captured.accuracy) : ''}
          />
          <ActionMessage state={state} />

          <div className="space-y-2 rounded-(--radius-control) bg-surface-2 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] font-semibold text-ink">1. Your location</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={locate}
                disabled={capture.status === 'locating'}
              >
                {captured ? <Crosshair aria-hidden="true" /> : <LocateFixed aria-hidden="true" />}
                {capture.status === 'locating'
                  ? 'Locating…'
                  : captured
                    ? 'Capture again'
                    : 'Capture my location'}
              </Button>
            </div>
            <p
              role="status"
              className={cn(
                'text-[12px]',
                capture.status === 'failed' || locationError
                  ? 'text-st-late'
                  : captured && captured.accuracy > maxAccuracyMeters
                    ? 'text-st-review'
                    : 'text-ink-3',
              )}
            >
              {locationError
                ? locationError
                : capture.status === 'failed'
                  ? capture.message
                  : captured
                    ? captured.accuracy > maxAccuracyMeters
                      ? `Captured, but only to ±${Math.round(captured.accuracy)} m - too vague to verify. Move outdoors and capture again.`
                      : `Captured to ±${Math.round(captured.accuracy)} m.`
                    : 'Use your phone at the property. Without a location, the visit is recorded as unverified.'}
            </p>
          </div>

          <SpecFields
            idPrefix="visit"
            state={state}
            defaults={{ accessGained: 'yes' }}
            fields={[
              {
                name: 'accessGained',
                label: '2. Access',
                kind: 'select',
                required: true,
                span: 3,
                options: [
                  { value: 'yes', label: 'Gained - property inspected' },
                  { value: 'no', label: 'Refused or not possible' },
                ],
              },
              { name: 'findings', label: 'Findings', kind: 'textarea', span: 3 },
              {
                name: 'remarks',
                label: 'Remarks (explain here if the location could not be verified)',
                kind: 'textarea',
                span: 3,
              },
            ]}
          />
          <div className="flex justify-end">
            <SubmitButton variant="outline" pendingLabel="Recording…">
              Record visit
            </SubmitButton>
          </div>
          <p className="text-[11.5px] text-ink-3">
            The time is recorded by the server when you submit. Photographs go under Supporting
            documents on the case, as “Site photographs”.
          </p>
        </form>
      ) : null}
    </div>
  );
}
