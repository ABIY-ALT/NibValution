import { Building2, Cog, FileText, Info, Paperclip } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listCategoryConfiguration } from '@/server/application/admin-service';
import {
  setPropertyCategoryActiveAction,
  setRequestTypeActiveAction,
} from '@/server/actions/admin-actions';
import { ActionForm } from '@/components/admin/action-form';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { CreateConfigurationDialog } from '@/components/admin/create-configuration-dialog';
import type { ConfigurationKind } from '@/lib/validation/admin';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  EmptyRow,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableBar,
  TableScroll,
  TableTitle,
  TableWrap,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.CATEGORY_UPDATE)) {
    return <AccessDenied permission="category:update" what="categories and types" />;
  }
  const { propertyCategories, requestTypes, documentCategories } =
    await listCategoryConfiguration(actor);

  // Request types are a separate grant from categories, so the chooser offers
  // only what this administrator can actually create. The action checks the
  // same thing again - this decides what is shown, not what is allowed.
  const addable: ConfigurationKind[] = [
    ...(actor.permissions.has(PERMISSIONS.CATEGORY_UPDATE)
      ? (['PROPERTY_CATEGORY', 'DOCUMENT_CATEGORY'] as const)
      : []),
    ...(actor.permissions.has(PERMISSIONS.REQUEST_TYPE_UPDATE) ? (['REQUEST_TYPE'] as const) : []),
  ];

  const civil = propertyCategories.filter((c) => c.discipline === 'CIVIL');
  const mechanical = propertyCategories.filter((c) => c.discipline === 'MECHANICAL');

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Administration"
        title="Categories & Types"
        subtitle="Property categories, request types and document categories are configuration rather than code, so the department can extend them without a deployment."
        actions={
          <>
            <Badge variant="brand" size="lg">
              {propertyCategories.length + requestTypes.length + documentCategories.length} entries
            </Badge>
            <CreateConfigurationDialog allowed={addable} />
          </>
        }
      />

      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertTitle>Disabling hides a value from new cases only</AlertTitle>
        <AlertDescription>
          Existing cases keep the category they were created with. A category in use is never
          removed, or historical valuations would lose the classification they were valued under.
        </AlertDescription>
      </Alert>

      <TableWrap>
        <TableBar>
          <TableTitle>
            <FileText className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
            Request types
          </TableTitle>
          <Badge variant="default">{requestTypes.length} types</Badge>
        </TableBar>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Description</TH>
                <TH>Prior case</TH>
                <TH>Status</TH>
                <TH className="text-right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {requestTypes.length === 0 ? (
                <EmptyRow colSpan={6} icon={FileText} title="No request types">
                  No request types are configured.
                </EmptyRow>
              ) : (
                requestTypes.map((type) => (
                  <TR key={type.id}>
                    <TD className="tabular text-[12px] font-semibold text-ink">{type.code}</TD>
                    <TD className="text-[13px] font-medium">{type.name}</TD>
                    <TD className="max-w-lg text-[11.5px] leading-relaxed text-ink-3">
                      {type.description}
                    </TD>
                    <TD>
                      {type.requiresPriorCase ? (
                        <Badge variant="accent" size="sm">
                          Required
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-ink-3">Not required</span>
                      )}
                    </TD>
                    <TD>
                      <Badge variant={type.isActive ? 'success' : 'inactive'} size="sm">
                        {type.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        <ActionForm
                          action={setRequestTypeActiveAction}
                          label={type.isActive ? 'Disable' : 'Enable'}
                          variant="outline"
                          hidden={{ requestTypeId: type.id, isActive: String(!type.isActive) }}
                        />
                      </div>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>

      {[
        { title: 'Civil property categories', items: civil, icon: Building2 },
        { title: 'Mechanical property categories', items: mechanical, icon: Cog },
      ].map((group) => (
        <TableWrap key={group.title}>
          <TableBar>
            <TableTitle>
              <group.icon className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
              {group.title}
            </TableTitle>
            <Badge variant="default">{group.items.length} categories</Badge>
          </TableBar>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Group</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {group.items.length === 0 ? (
                  <EmptyRow colSpan={5} icon={group.icon} title="No categories">
                    No categories are configured for this discipline.
                  </EmptyRow>
                ) : (
                  group.items.map((category) => (
                    <TR key={category.id}>
                      <TD className="tabular text-[12px] font-semibold text-ink">
                        {category.code}
                      </TD>
                      <TD
                        className={
                          category.parent ? 'pl-8 text-[12.5px]' : 'text-[13px] font-medium'
                        }
                      >
                        {category.name}
                        {category.description ? (
                          <span className="block max-w-md text-[11px] font-normal leading-snug text-ink-3">
                            {category.description}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-[11.5px] text-ink-3">{category.parent?.name ?? '—'}</TD>
                      <TD>
                        <Badge variant={category.isActive ? 'success' : 'inactive'} size="sm">
                          {category.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                      </TD>
                      <TD>
                        <div className="flex justify-end">
                          <ActionForm
                            action={setPropertyCategoryActiveAction}
                            label={category.isActive ? 'Disable' : 'Enable'}
                            variant="outline"
                            hidden={{
                              categoryId: category.id,
                              isActive: String(!category.isActive),
                            }}
                          />
                        </div>
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableScroll>
        </TableWrap>
      ))}

      <TableWrap>
        <TableBar>
          <TableTitle>
            <Paperclip className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
            Document categories
          </TableTitle>
          <Badge variant="default">{documentCategories.length} categories</Badge>
        </TableBar>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Applies to</TH>
                <TH>Mandatory</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {documentCategories.length === 0 ? (
                <EmptyRow colSpan={5} icon={Paperclip} title="No document categories">
                  No document categories are configured.
                </EmptyRow>
              ) : (
                documentCategories.map((category) => (
                  <TR key={category.id}>
                    <TD className="tabular text-[12px] font-semibold text-ink">{category.code}</TD>
                    <TD className="text-[13px] font-medium">
                      {category.name}
                      {category.description ? (
                        <span className="block max-w-md text-[11px] font-normal leading-snug text-ink-3">
                          {category.description}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-[12.5px]">{category.discipline ?? 'All disciplines'}</TD>
                    <TD>
                      {category.isMandatory ? (
                        <Badge variant="accent" size="sm">
                          Mandatory
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-ink-3">Optional</span>
                      )}
                    </TD>
                    <TD>
                      <Badge variant={category.isActive ? 'success' : 'inactive'} size="sm">
                        {category.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>
    </div>
  );
}
