import type { $Enums } from '@prisma/client';
import type {
  ApprovalDecision,
  ApprovalLevel,
  CaseStatus,
  ConditionGrade,
  ConstructionStatus,
  DepreciationMethod,
  Discipline,
  LandHoldingRight,
  MechanicalItemKind,
  NotificationChannel,
  NotificationStatus,
  OrganizationType,
  ParameterType,
  ReportType,
  ScanStatus,
  SignatureStatus,
  SiteVisitCheck,
  SlaStatus,
  TaskType,
  ValuationApproachKind,
  ValuationStatus,
} from '@/server/domain/shared/enums';

/**
 * Compile-time parity between the domain enums and the Prisma enums.
 *
 * The domain layer defines its own string-union enums so it can be unit-tested
 * without a generated Prisma client (docs/06-folder-structure.md). That
 * duplication is only safe if drift is impossible, so this file asserts
 * bidirectional assignability for every pair. Adding a value to schema.prisma
 * without adding it to `domain/shared/enums.ts` - or vice versa - fails
 * `npm run typecheck`, which runs in CI before anything reaches an environment.
 *
 * Nothing is exported at runtime; these are type-level assertions only.
 */

/** Resolves to `true` only when the two unions contain exactly the same members. */
type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Fails to compile unless `T` is `true`. The error points at the offending line,
 * naming the enum that has drifted.
 */
type Expect<T extends true> = T;

type _CaseStatus = Expect<SameMembers<CaseStatus, $Enums.CaseStatus>>;
type _Discipline = Expect<SameMembers<Discipline, $Enums.Discipline>>;
type _ApprovalLevel = Expect<SameMembers<ApprovalLevel, $Enums.ApprovalLevel>>;
type _ApprovalDecision = Expect<SameMembers<ApprovalDecision, $Enums.ApprovalDecision>>;
type _LandHoldingRight = Expect<SameMembers<LandHoldingRight, $Enums.LandHoldingRight>>;
type _ConstructionStatus = Expect<SameMembers<ConstructionStatus, $Enums.ConstructionStatus>>;
type _ConditionGrade = Expect<SameMembers<ConditionGrade, $Enums.ConditionGrade>>;
type _DepreciationMethod = Expect<SameMembers<DepreciationMethod, $Enums.DepreciationMethod>>;
type _TaskType = Expect<SameMembers<TaskType, $Enums.TaskType>>;
type _SlaStatus = Expect<SameMembers<SlaStatus, $Enums.SlaStatus>>;
type _ScanStatus = Expect<SameMembers<ScanStatus, $Enums.ScanStatus>>;
type _ReportType = Expect<SameMembers<ReportType, $Enums.ReportType>>;
type _ValuationStatus = Expect<SameMembers<ValuationStatus, $Enums.ValuationStatus>>;
type _NotificationChannel = Expect<SameMembers<NotificationChannel, $Enums.NotificationChannel>>;
type _NotificationStatus = Expect<SameMembers<NotificationStatus, $Enums.NotificationStatus>>;
type _OrganizationType = Expect<SameMembers<OrganizationType, $Enums.OrganizationType>>;
type _MechanicalItemKind = Expect<SameMembers<MechanicalItemKind, $Enums.MechanicalItemKind>>;
type _ParameterType = Expect<SameMembers<ParameterType, $Enums.ParameterType>>;
type _SignatureStatus = Expect<SameMembers<SignatureStatus, $Enums.SignatureStatus>>;
type _SiteVisitCheck = Expect<SameMembers<SiteVisitCheck, $Enums.SiteVisitCheck>>;
type _ValuationApproachKind = Expect<
  SameMembers<ValuationApproachKind, $Enums.ValuationApproachKind>
>;

export {};
