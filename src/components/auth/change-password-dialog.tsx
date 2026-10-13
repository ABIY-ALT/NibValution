'use client';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChangePasswordForm } from './change-password-form';
import type { PasswordRules } from './password-checklist';

/**
 * Change password without leaving the page: a pop-up over the application,
 * rather than a trip to the sign-in screen. The content unmounts when closed,
 * so nothing typed is still there the next time it opens.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
  rules,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: PasswordRules;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Enter your current password, then choose a new one that meets the policy.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ChangePasswordForm rules={rules} onCancel={() => onOpenChange(false)} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
