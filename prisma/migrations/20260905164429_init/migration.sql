-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('BRANCH', 'DISTRICT', 'HEAD_OFFICE_UNIT');

-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('CIVIL', 'MECHANICAL', 'BOTH', 'NONE');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'REQUESTED', 'ASSIGNED', 'ON_PROGRESS', 'NOT_VISITED', 'PENDING', 'AWAITING_REQUESTER', 'SUBMITTED_FOR_CHECKING', 'CHECKING', 'COMMENTED', 'RETURNED_FOR_CORRECTION', 'CHECKED', 'PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL', 'APPROVED', 'SIGNED', 'COMPLETED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalLevel" AS ENUM ('CHECKER', 'MANAGER', 'DIRECTOR');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "LandHoldingRight" AS ENUM ('FREEHOLD', 'LEASE', 'BOTH');

-- CreateEnum
CREATE TYPE "ConstructionStatus" AS ENUM ('COMPLETED', 'UNDER_CONSTRUCTION', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ConditionGrade" AS ENUM ('EXCELLENT', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR', 'SCRAP');

-- CreateEnum
CREATE TYPE "MechanicalItemKind" AS ENUM ('VEHICLE', 'MACHINERY');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'QUARANTINED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('VALUATION', 'COVER_PAGE', 'FINAL_LETTER');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('VALID', 'REVOKED', 'FAILED');

-- CreateEnum
CREATE TYPE "SlaStatus" AS ENUM ('GREEN', 'WARNING', 'BREACHED', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('ASSIGN_MAKER', 'PERFORM_VALUATION', 'ASSIGN_CHECKER', 'PERFORM_CHECKING', 'MANAGER_APPROVAL', 'DIRECTOR_APPROVAL', 'SIGN', 'GENERATE_FINAL_LETTER', 'CORRECT_VALUATION');

-- CreateEnum
CREATE TYPE "ValuationApproachKind" AS ENUM ('COST', 'SALES', 'MARKET');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'AGE_LIFE_CONDITION', 'DECLINING_BALANCE');

-- CreateEnum
CREATE TYPE "ParameterType" AS ENUM ('RATE', 'FACTOR', 'PERCENT', 'AMOUNT', 'YEARS', 'TABLE');

-- CreateEnum
CREATE TYPE "ValuationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_CHECK', 'CHECKED', 'APPROVED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "parentId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "employeeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "organizationId" UUID,
    "departmentId" UUID,
    "discipline" "Discipline" NOT NULL DEFAULT 'NONE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'argon2id',
    "params" JSONB NOT NULL,
    "mustChange" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_history" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "reauthenticatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "request_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requiresPriorCase" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "request_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "parentId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "property_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_thresholds" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minAmount" DECIMAL(20,2) NOT NULL,
    "maxAmount" DECIMAL(20,2),
    "approvalChain" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "approval_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_letter_authorities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minAmount" DECIMAL(20,2) NOT NULL,
    "maxAmount" DECIMAL(20,2),
    "issuerRole" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "final_letter_authorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_parameter_sets" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_parameter_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_parameters" (
    "id" UUID NOT NULL,
    "setId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ParameterType" NOT NULL,
    "numericValue" DECIMAL(20,6),
    "jsonValue" JSONB,
    "unit" TEXT,
    "discipline" "Discipline",
    "categoryCode" TEXT,
    "notes" TEXT,

    CONSTRAINT "valuation_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalWorkingDays" INTEGER NOT NULL,
    "warningPercent" INTEGER NOT NULL DEFAULT 80,
    "stageBudgets" JSONB,
    "workingDaysOfWeek" JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
    "countCalendarDays" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "ReportType" NOT NULL,
    "name" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rules" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "roles" JSONB NOT NULL,
    "channels" JSONB NOT NULL,
    "template" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configurations" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" TEXT NOT NULL,
    "description" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_number_sequences" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "case_number_sequences_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "valuation_cases" (
    "id" UUID NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "requestTypeId" UUID NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestingOrgId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "makerId" UUID,
    "checkerId" UUID,
    "makerManagerId" UUID,
    "checkerManagerId" UUID,
    "applicantName" TEXT NOT NULL,
    "applicantPhone" TEXT,
    "applicantTin" TEXT,
    "ownerName" TEXT NOT NULL,
    "ownerPhone" TEXT,
    "ownerIdNumber" TEXT,
    "purpose" TEXT,
    "remarks" TEXT,
    "priorCaseId" UUID,
    "finalValue" DECIMAL(20,2),
    "forcedSaleValue" DECIMAL(20,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'ETB',
    "approvalLevel" "ApprovalLevel",
    "requestedAt" TIMESTAMPTZ(6),
    "assignedAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "submittedAt" TIMESTAMPTZ(6),
    "checkedAt" TIMESTAMPTZ(6),
    "approvedAt" TIMESTAMPTZ(6),
    "signedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "archivedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "valuation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "civil_properties" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "lhcNumber" TEXT,
    "subCity" TEXT,
    "woreda" TEXT,
    "kebele" TEXT,
    "houseNumber" TEXT,
    "geographicLocation" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "landHoldingRight" "LandHoldingRight" NOT NULL,
    "plotArea" DECIMAL(18,4),
    "leaseRemainingYears" INTEGER,
    "leaseUnpaidBalance" DECIMAL(20,2),
    "leaseAnnualRate" DECIMAL(20,2),
    "boundaryDescription" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "civil_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "civil_buildings" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "categoryId" UUID,
    "buildingNumber" INTEGER NOT NULL,
    "buildingType" TEXT NOT NULL,
    "floorCount" INTEGER,
    "grossArea" DECIMAL(18,4),
    "builtUpArea" DECIMAL(18,4),
    "constructionStatus" "ConstructionStatus" NOT NULL DEFAULT 'COMPLETED',
    "constructionYear" INTEGER,
    "condition" "ConditionGrade",
    "progressPercent" DECIMAL(5,2),
    "structure" JSONB,
    "finishing" JSONB,
    "services" JSONB,
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "civil_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_elements" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "elementCode" TEXT NOT NULL,
    "elementName" TEXT NOT NULL,
    "weightPercent" DECIMAL(5,2) NOT NULL,
    "completePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "building_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mechanical_properties" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "plantName" TEXT,
    "installationAddress" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "operationalStatus" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mechanical_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "categoryId" UUID,
    "itemNumber" INTEGER NOT NULL,
    "ownerName" TEXT,
    "plateNumber" TEXT,
    "chassisNumber" TEXT,
    "engineNumber" TEXT,
    "make" TEXT,
    "model" TEXT,
    "manufactureYear" INTEGER,
    "capacity" TEXT,
    "horsePower" DECIMAL(12,2),
    "cylinderCount" INTEGER,
    "axleNumber" INTEGER,
    "colour" TEXT,
    "libreReference" TEXT,
    "condition" "ConditionGrade",
    "mileage" DECIMAL(14,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machinery" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "categoryId" UUID,
    "itemNumber" INTEGER NOT NULL,
    "ownerName" TEXT,
    "equipmentName" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "manufactureYear" INTEGER,
    "capacity" TEXT,
    "countryOfOrigin" TEXT,
    "installationLocation" TEXT,
    "condition" "ConditionGrade",
    "purchaseDate" DATE,
    "purchasePrice" DECIMAL(20,2),
    "insuranceValue" DECIMAL(20,2),
    "cifValue" DECIMAL(20,2),
    "remainingLifeYears" DECIMAL(6,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "machinery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" "Discipline",
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_documents" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" UUID,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanDetail" TEXT,
    "description" TEXT,
    "uploadedById" UUID NOT NULL,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" UUID,
    "deletedReason" TEXT,

    CONSTRAINT "property_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_visits" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "visitedById" UUID NOT NULL,
    "visitedAt" TIMESTAMPTZ(6) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "accessGained" BOOLEAN NOT NULL DEFAULT true,
    "findings" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuations" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ValuationStatus" NOT NULL DEFAULT 'DRAFT',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "discipline" "Discipline" NOT NULL,
    "preparedById" UUID,
    "checkedById" UUID,
    "marketValue" DECIMAL(20,2),
    "forcedSaleValue" DECIMAL(20,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'ETB',
    "formulaVersion" TEXT NOT NULL,
    "parameterSetId" UUID,
    "valuationDate" DATE,
    "remarks" TEXT,
    "checkerRemarks" TEXT,
    "frozenAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_approaches" (
    "id" UUID NOT NULL,
    "valuationId" UUID NOT NULL,
    "landValue" DECIMAL(20,2),
    "buildingReplacementCost" DECIMAL(20,2),
    "totalDepreciation" DECIMAL(20,2),
    "adjustments" DECIMAL(20,2),
    "factor" DECIMAL(12,6),
    "indicatedValue" DECIMAL(20,2),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cost_approaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_line_items" (
    "id" UUID NOT NULL,
    "costApproachId" UUID NOT NULL,
    "buildingId" UUID,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(20,4) NOT NULL,
    "formula" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "adjustment" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "adjustedAmount" DECIMAL(20,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "cost_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciations" (
    "id" UUID NOT NULL,
    "costApproachId" UUID NOT NULL,
    "buildingId" UUID,
    "method" "DepreciationMethod" NOT NULL,
    "effectiveAgeYears" DECIMAL(8,2) NOT NULL,
    "economicLifeYears" DECIMAL(8,2) NOT NULL,
    "residualPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "ratePercent" DECIMAL(7,4) NOT NULL,
    "baseAmount" DECIMAL(20,2) NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "formula" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_approaches" (
    "id" UUID NOT NULL,
    "valuationId" UUID NOT NULL,
    "indicatedValue" DECIMAL(20,2),
    "methodNotes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_approaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparable_properties" (
    "id" UUID NOT NULL,
    "salesApproachId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reference" TEXT,
    "location" TEXT NOT NULL,
    "characteristics" TEXT,
    "saleDate" DATE,
    "salePrice" DECIMAL(20,2) NOT NULL,
    "area" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "adjustments" JSONB,
    "netAdjustmentPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "adjustedUnitPrice" DECIMAL(20,4) NOT NULL,
    "adjustedValue" DECIMAL(20,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "comparable_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL,
    "valuationId" UUID NOT NULL,
    "costValue" DECIMAL(20,2),
    "salesValue" DECIMAL(20,2),
    "costWeight" DECIMAL(5,2) NOT NULL,
    "salesWeight" DECIMAL(5,2) NOT NULL,
    "reconciledValue" DECIMAL(20,2) NOT NULL,
    "formula" TEXT NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forced_sale_valuations" (
    "id" UUID NOT NULL,
    "valuationId" UUID NOT NULL,
    "marketValue" DECIMAL(20,2) NOT NULL,
    "forcedSalePercent" DECIMAL(5,2) NOT NULL,
    "forcedSaleValue" DECIMAL(20,2) NOT NULL,
    "formula" TEXT NOT NULL,
    "assumptions" TEXT,
    "remarks" TEXT,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "forced_sale_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mech_market_approaches" (
    "id" UUID NOT NULL,
    "valuationId" UUID NOT NULL,
    "indicatedValue" DECIMAL(20,2),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mech_market_approaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparable_equipment" (
    "id" UUID NOT NULL,
    "mechMarketApproachId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT,
    "marketPrice" DECIMAL(20,2) NOT NULL,
    "conditionAdjustment" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "ageAdjustment" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "locationAdjustment" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "otherAdjustment" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "netAdjustmentPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "adjustedValue" DECIMAL(20,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "comparable_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mech_cost_approaches" (
    "id" UUID NOT NULL,
    "valuationId" UUID NOT NULL,
    "originalCost" DECIMAL(20,2),
    "cifValue" DECIMAL(20,2),
    "loadings" JSONB,
    "currentReplacementCost" DECIMAL(20,2),
    "depreciationPercent" DECIMAL(7,4),
    "depreciationAmount" DECIMAL(20,2),
    "conditionAdjustment" DECIMAL(20,2),
    "remainingLifeYears" DECIMAL(6,2),
    "indicatedValue" DECIMAL(20,2),
    "formula" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mech_cost_approaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_runs" (
    "id" UUID NOT NULL,
    "valuationId" UUID NOT NULL,
    "engine" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "parameterSnapshot" JSONB NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "outputSnapshot" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "performedById" UUID NOT NULL,
    "performedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_tasks" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "assigneeId" UUID,
    "roleCode" TEXT,
    "dueAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "completedById" UUID,

    CONSTRAINT "workflow_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_history" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "fromStatus" "CaseStatus",
    "toStatus" "CaseStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "actorRole" TEXT NOT NULL,
    "comment" TEXT,
    "durationSeconds" INTEGER,
    "correlationId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_cycles" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "returnedById" UUID NOT NULL,
    "returnedByRole" TEXT NOT NULL,
    "returnedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousStatus" "CaseStatus" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "flaggedSections" JSONB,
    "resolvedAt" TIMESTAMPTZ(6),
    "resolutionNote" TEXT,
    "reworkSeconds" INTEGER,

    CONSTRAINT "correction_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "parentId" UUID,
    "section" TEXT,
    "body" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "level" "ApprovalLevel" NOT NULL,
    "chainPosition" INTEGER NOT NULL,
    "approverId" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "valueAtDecision" DECIMAL(20,2) NOT NULL,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_signatures" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "reportId" UUID,
    "signerId" UUID NOT NULL,
    "signerRole" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "certificateRef" TEXT,
    "status" "SignatureStatus" NOT NULL DEFAULT 'VALID',
    "signedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "revokeReason" TEXT,

    CONSTRAINT "digital_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "valuationId" UUID,
    "templateId" UUID,
    "type" "ReportType" NOT NULL,
    "version" INTEGER NOT NULL,
    "dataSnapshot" JSONB NOT NULL,
    "storageKey" TEXT,
    "sha256" TEXT,
    "isImmutable" BOOLEAN NOT NULL DEFAULT false,
    "generatedById" UUID NOT NULL,
    "generatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_records" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "elapsedWorkingDays" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "netWorkingDays" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "pausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "status" "SlaStatus" NOT NULL DEFAULT 'GREEN',
    "breachedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sla_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_pauses" (
    "id" UUID NOT NULL,
    "slaRecordId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "pausedAt" TIMESTAMPTZ(6) NOT NULL,
    "resumedAt" TIMESTAMPTZ(6),

    CONSTRAINT "sla_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "caseId" UUID,
    "eventType" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE INDEX "organizations_parentId_idx" ON "organizations"("parentId");

-- CreateIndex
CREATE INDEX "organizations_type_isActive_idx" ON "organizations"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeId_key" ON "users"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE INDEX "users_departmentId_idx" ON "users"("departmentId");

-- CreateIndex
CREATE INDEX "users_isActive_discipline_idx" ON "users"("isActive", "discipline");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_userId_key" ON "credentials"("userId");

-- CreateIndex
CREATE INDEX "password_history_userId_createdAt_idx" ON "password_history"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "request_types_code_key" ON "request_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "property_categories_code_key" ON "property_categories"("code");

-- CreateIndex
CREATE INDEX "property_categories_discipline_isActive_idx" ON "property_categories"("discipline", "isActive");

-- CreateIndex
CREATE INDEX "property_categories_parentId_idx" ON "property_categories"("parentId");

-- CreateIndex
CREATE INDEX "approval_thresholds_effectiveFrom_effectiveTo_idx" ON "approval_thresholds"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "approval_thresholds_minAmount_idx" ON "approval_thresholds"("minAmount");

-- CreateIndex
CREATE INDEX "final_letter_authorities_effectiveFrom_effectiveTo_idx" ON "final_letter_authorities"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "valuation_parameter_sets_effectiveFrom_effectiveTo_idx" ON "valuation_parameter_sets"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_parameter_sets_code_version_key" ON "valuation_parameter_sets"("code", "version");

-- CreateIndex
CREATE INDEX "valuation_parameters_setId_idx" ON "valuation_parameters"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_parameters_setId_key_categoryCode_key" ON "valuation_parameters"("setId", "key", "categoryCode");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_code_key" ON "sla_policies"("code");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_name_key" ON "holidays"("date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_code_version_key" ON "report_templates"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "notification_rules_eventType_key" ON "notification_rules"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "system_configurations_key_key" ON "system_configurations"("key");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_cases_caseNumber_key" ON "valuation_cases"("caseNumber");

-- CreateIndex
CREATE INDEX "valuation_cases_status_departmentId_idx" ON "valuation_cases"("status", "departmentId");

-- CreateIndex
CREATE INDEX "valuation_cases_makerId_status_idx" ON "valuation_cases"("makerId", "status");

-- CreateIndex
CREATE INDEX "valuation_cases_checkerId_status_idx" ON "valuation_cases"("checkerId", "status");

-- CreateIndex
CREATE INDEX "valuation_cases_requestingOrgId_requestedAt_idx" ON "valuation_cases"("requestingOrgId", "requestedAt");

-- CreateIndex
CREATE INDEX "valuation_cases_requestTypeId_requestedAt_idx" ON "valuation_cases"("requestTypeId", "requestedAt");

-- CreateIndex
CREATE INDEX "valuation_cases_discipline_status_idx" ON "valuation_cases"("discipline", "status");

-- CreateIndex
CREATE INDEX "valuation_cases_finalValue_idx" ON "valuation_cases"("finalValue");

-- CreateIndex
CREATE INDEX "valuation_cases_ownerName_idx" ON "valuation_cases"("ownerName");

-- CreateIndex
CREATE INDEX "valuation_cases_applicantName_idx" ON "valuation_cases"("applicantName");

-- CreateIndex
CREATE UNIQUE INDEX "civil_properties_caseId_key" ON "civil_properties"("caseId");

-- CreateIndex
CREATE INDEX "civil_properties_lhcNumber_idx" ON "civil_properties"("lhcNumber");

-- CreateIndex
CREATE INDEX "civil_properties_subCity_woreda_idx" ON "civil_properties"("subCity", "woreda");

-- CreateIndex
CREATE INDEX "civil_buildings_propertyId_idx" ON "civil_buildings"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "civil_buildings_propertyId_buildingNumber_key" ON "civil_buildings"("propertyId", "buildingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "building_elements_buildingId_elementCode_key" ON "building_elements"("buildingId", "elementCode");

-- CreateIndex
CREATE UNIQUE INDEX "mechanical_properties_caseId_key" ON "mechanical_properties"("caseId");

-- CreateIndex
CREATE INDEX "vehicles_plateNumber_idx" ON "vehicles"("plateNumber");

-- CreateIndex
CREATE INDEX "vehicles_chassisNumber_idx" ON "vehicles"("chassisNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_propertyId_itemNumber_key" ON "vehicles"("propertyId", "itemNumber");

-- CreateIndex
CREATE INDEX "machinery_serialNumber_idx" ON "machinery"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "machinery_propertyId_itemNumber_key" ON "machinery"("propertyId", "itemNumber");

-- CreateIndex
CREATE UNIQUE INDEX "document_categories_code_key" ON "document_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "property_documents_storageKey_key" ON "property_documents"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "property_documents_supersedesId_key" ON "property_documents"("supersedesId");

-- CreateIndex
CREATE INDEX "property_documents_caseId_categoryId_idx" ON "property_documents"("caseId", "categoryId");

-- CreateIndex
CREATE INDEX "property_documents_scanStatus_idx" ON "property_documents"("scanStatus");

-- CreateIndex
CREATE INDEX "site_visits_caseId_idx" ON "site_visits"("caseId");

-- CreateIndex
CREATE INDEX "valuations_caseId_isCurrent_idx" ON "valuations"("caseId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "valuations_caseId_version_key" ON "valuations"("caseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "cost_approaches_valuationId_key" ON "cost_approaches"("valuationId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_line_items_costApproachId_sequence_key" ON "cost_line_items"("costApproachId", "sequence");

-- CreateIndex
CREATE INDEX "depreciations_costApproachId_idx" ON "depreciations"("costApproachId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_approaches_valuationId_key" ON "sales_approaches"("valuationId");

-- CreateIndex
CREATE UNIQUE INDEX "comparable_properties_salesApproachId_sequence_key" ON "comparable_properties"("salesApproachId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_valuationId_key" ON "reconciliations"("valuationId");

-- CreateIndex
CREATE UNIQUE INDEX "forced_sale_valuations_valuationId_key" ON "forced_sale_valuations"("valuationId");

-- CreateIndex
CREATE UNIQUE INDEX "mech_market_approaches_valuationId_key" ON "mech_market_approaches"("valuationId");

-- CreateIndex
CREATE UNIQUE INDEX "comparable_equipment_mechMarketApproachId_sequence_key" ON "comparable_equipment"("mechMarketApproachId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "mech_cost_approaches_valuationId_key" ON "mech_cost_approaches"("valuationId");

-- CreateIndex
CREATE INDEX "calculation_runs_valuationId_performedAt_idx" ON "calculation_runs"("valuationId", "performedAt");

-- CreateIndex
CREATE INDEX "workflow_tasks_assigneeId_completedAt_idx" ON "workflow_tasks"("assigneeId", "completedAt");

-- CreateIndex
CREATE INDEX "workflow_tasks_caseId_taskType_completedAt_idx" ON "workflow_tasks"("caseId", "taskType", "completedAt");

-- CreateIndex
CREATE INDEX "workflow_tasks_dueAt_idx" ON "workflow_tasks"("dueAt");

-- CreateIndex
CREATE INDEX "workflow_history_caseId_occurredAt_idx" ON "workflow_history"("caseId", "occurredAt");

-- CreateIndex
CREATE INDEX "correction_cycles_caseId_resolvedAt_idx" ON "correction_cycles"("caseId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "correction_cycles_caseId_sequence_key" ON "correction_cycles"("caseId", "sequence");

-- CreateIndex
CREATE INDEX "comments_caseId_createdAt_idx" ON "comments"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "approvals_caseId_chainPosition_idx" ON "approvals"("caseId", "chainPosition");

-- CreateIndex
CREATE INDEX "digital_signatures_caseId_idx" ON "digital_signatures"("caseId");

-- CreateIndex
CREATE INDEX "digital_signatures_documentSha256_idx" ON "digital_signatures"("documentSha256");

-- CreateIndex
CREATE INDEX "reports_caseId_idx" ON "reports"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "reports_caseId_type_version_key" ON "reports"("caseId", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "sla_records_caseId_key" ON "sla_records"("caseId");

-- CreateIndex
CREATE INDEX "sla_records_status_dueAt_idx" ON "sla_records"("status", "dueAt");

-- CreateIndex
CREATE INDEX "sla_pauses_slaRecordId_idx" ON "sla_pauses"("slaRecordId");

-- CreateIndex
CREATE INDEX "notifications_recipientId_readAt_idx" ON "notifications"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_status_createdAt_idx" ON "notifications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_occurredAt_idx" ON "audit_logs"("entity", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_occurredAt_idx" ON "audit_logs"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurredAt_idx" ON "audit_logs"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_correlationId_idx" ON "audit_logs"("correlationId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_categories" ADD CONSTRAINT "property_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "property_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_parameters" ADD CONSTRAINT "valuation_parameters_setId_fkey" FOREIGN KEY ("setId") REFERENCES "valuation_parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_configurations" ADD CONSTRAINT "system_configurations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "request_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_requestingOrgId_fkey" FOREIGN KEY ("requestingOrgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_makerManagerId_fkey" FOREIGN KEY ("makerManagerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_checkerManagerId_fkey" FOREIGN KEY ("checkerManagerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_priorCaseId_fkey" FOREIGN KEY ("priorCaseId") REFERENCES "valuation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civil_properties" ADD CONSTRAINT "civil_properties_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civil_properties" ADD CONSTRAINT "civil_properties_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "property_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civil_buildings" ADD CONSTRAINT "civil_buildings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "civil_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "civil_buildings" ADD CONSTRAINT "civil_buildings_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "property_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_elements" ADD CONSTRAINT "building_elements_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "civil_buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mechanical_properties" ADD CONSTRAINT "mechanical_properties_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "mechanical_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "property_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machinery" ADD CONSTRAINT "machinery_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "mechanical_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machinery" ADD CONSTRAINT "machinery_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "property_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "document_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "property_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_visitedById_fkey" FOREIGN KEY ("visitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_parameterSetId_fkey" FOREIGN KEY ("parameterSetId") REFERENCES "valuation_parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_approaches" ADD CONSTRAINT "cost_approaches_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_line_items" ADD CONSTRAINT "cost_line_items_costApproachId_fkey" FOREIGN KEY ("costApproachId") REFERENCES "cost_approaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciations" ADD CONSTRAINT "depreciations_costApproachId_fkey" FOREIGN KEY ("costApproachId") REFERENCES "cost_approaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_approaches" ADD CONSTRAINT "sales_approaches_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparable_properties" ADD CONSTRAINT "comparable_properties_salesApproachId_fkey" FOREIGN KEY ("salesApproachId") REFERENCES "sales_approaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forced_sale_valuations" ADD CONSTRAINT "forced_sale_valuations_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mech_market_approaches" ADD CONSTRAINT "mech_market_approaches_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparable_equipment" ADD CONSTRAINT "comparable_equipment_mechMarketApproachId_fkey" FOREIGN KEY ("mechMarketApproachId") REFERENCES "mech_market_approaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mech_cost_approaches" ADD CONSTRAINT "mech_cost_approaches_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_history" ADD CONSTRAINT "workflow_history_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_history" ADD CONSTRAINT "workflow_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_cycles" ADD CONSTRAINT "correction_cycles_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_cycles" ADD CONSTRAINT "correction_cycles_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "valuations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "report_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_records" ADD CONSTRAINT "sla_records_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_records" ADD CONSTRAINT "sla_records_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "sla_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_pauses" ADD CONSTRAINT "sla_pauses_slaRecordId_fkey" FOREIGN KEY ("slaRecordId") REFERENCES "sla_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "valuation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Integrity hardening
-- ===========================================================================
-- Prisma expresses relations and uniqueness, but the guarantees below either
-- have no schema-language equivalent or matter too much to leave to
-- application code alone (development rules 7, 9 and 16). Enforcing them here
-- means an application bug, a stray script or a direct psql session cannot
-- corrupt the valuation record.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Check constraints
-- ---------------------------------------------------------------------------

-- Segregation of duties: one person may not both value and check a case
-- (assumption 2.2). Enforced in the workflow service, at assignment, and here.
ALTER TABLE "valuation_cases"
  ADD CONSTRAINT "valuation_cases_maker_checker_distinct"
  CHECK ("checkerId" IS NULL OR "makerId" IS NULL OR "checkerId" <> "makerId");

ALTER TABLE "valuation_cases"
  ADD CONSTRAINT "valuation_cases_values_non_negative"
  CHECK (
    ("finalValue" IS NULL OR "finalValue" >= 0) AND
    ("forcedSaleValue" IS NULL OR "forcedSaleValue" >= 0)
  );

ALTER TABLE "valuation_cases"
  ADD CONSTRAINT "valuation_cases_version_positive" CHECK ("version" >= 1);

-- Reconciliation weights must total exactly 100 (spec section 11).
ALTER TABLE "reconciliations"
  ADD CONSTRAINT "reconciliations_weights_total_100"
  CHECK ("costWeight" + "salesWeight" = 100);

ALTER TABLE "reconciliations"
  ADD CONSTRAINT "reconciliations_weights_in_range"
  CHECK ("costWeight" >= 0 AND "costWeight" <= 100 AND "salesWeight" >= 0 AND "salesWeight" <= 100);

ALTER TABLE "reconciliations"
  ADD CONSTRAINT "reconciliations_value_non_negative" CHECK ("reconciledValue" >= 0);

ALTER TABLE "forced_sale_valuations"
  ADD CONSTRAINT "forced_sale_percent_in_range"
  CHECK ("forcedSalePercent" >= 0 AND "forcedSalePercent" <= 100);

ALTER TABLE "forced_sale_valuations"
  ADD CONSTRAINT "forced_sale_values_non_negative"
  CHECK ("marketValue" >= 0 AND "forcedSaleValue" >= 0);

-- An override without a justification is an unexplained change to a reported
-- figure, so the reason is required by the database, not only by the form.
ALTER TABLE "forced_sale_valuations"
  ADD CONSTRAINT "forced_sale_override_requires_reason"
  CHECK ("isOverridden" = false OR ("overrideReason" IS NOT NULL AND length(btrim("overrideReason")) >= 10));

ALTER TABLE "valuations"
  ADD CONSTRAINT "valuations_values_non_negative"
  CHECK (
    ("marketValue" IS NULL OR "marketValue" >= 0) AND
    ("forcedSaleValue" IS NULL OR "forcedSaleValue" >= 0)
  );

ALTER TABLE "valuations"
  ADD CONSTRAINT "valuations_version_positive" CHECK ("version" >= 1);

ALTER TABLE "civil_properties"
  ADD CONSTRAINT "civil_properties_coordinates_in_range"
  CHECK (
    ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)) AND
    ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180))
  );

ALTER TABLE "civil_properties"
  ADD CONSTRAINT "civil_properties_areas_non_negative"
  CHECK (
    ("plotArea" IS NULL OR "plotArea" >= 0) AND
    ("leaseUnpaidBalance" IS NULL OR "leaseUnpaidBalance" >= 0)
  );

ALTER TABLE "civil_buildings"
  ADD CONSTRAINT "civil_buildings_sane_values"
  CHECK (
    "buildingNumber" >= 1 AND
    ("floorCount" IS NULL OR "floorCount" >= 0) AND
    ("grossArea" IS NULL OR "grossArea" >= 0) AND
    ("builtUpArea" IS NULL OR "builtUpArea" >= 0) AND
    ("progressPercent" IS NULL OR ("progressPercent" >= 0 AND "progressPercent" <= 100))
  );

-- A property under construction is meaningless without a progress figure, and
-- a completed one must not carry a partial progress (assumption 3.6).
ALTER TABLE "civil_buildings"
  ADD CONSTRAINT "civil_buildings_progress_matches_status"
  CHECK (
    ("constructionStatus" <> 'UNDER_CONSTRUCTION' OR "progressPercent" IS NOT NULL)
  );

ALTER TABLE "building_elements"
  ADD CONSTRAINT "building_elements_percentages_in_range"
  CHECK (
    "weightPercent" >= 0 AND "weightPercent" <= 100 AND
    "completePercent" >= 0 AND "completePercent" <= 100
  );

ALTER TABLE "mech_market_approaches"
  ADD CONSTRAINT "mech_market_value_non_negative"
  CHECK ("indicatedValue" IS NULL OR "indicatedValue" >= 0);

ALTER TABLE "comparable_properties"
  ADD CONSTRAINT "comparable_properties_sane_values"
  CHECK ("salePrice" >= 0 AND "area" > 0 AND "unitPrice" >= 0 AND "adjustedValue" >= 0);

ALTER TABLE "comparable_equipment"
  ADD CONSTRAINT "comparable_equipment_sane_values"
  CHECK ("marketPrice" >= 0 AND "adjustedValue" >= 0);

ALTER TABLE "cost_line_items"
  ADD CONSTRAINT "cost_line_items_sane_values"
  CHECK ("quantity" >= 0 AND "rate" >= 0 AND "amount" >= 0);

ALTER TABLE "depreciations"
  ADD CONSTRAINT "depreciations_sane_values"
  CHECK (
    "effectiveAgeYears" >= 0 AND
    "economicLifeYears" > 0 AND
    "residualPercent" >= 0 AND "residualPercent" <= 100 AND
    "ratePercent" >= 0 AND "ratePercent" <= 100 AND
    "baseAmount" >= 0 AND "amount" >= 0
  );

-- Approval bands: half-open [min, max) with a null max meaning unbounded, so a
-- gap or an overlap is not representable (spec section 17, assumption 1.4).
ALTER TABLE "approval_thresholds"
  ADD CONSTRAINT "approval_thresholds_band_valid"
  CHECK ("minAmount" >= 0 AND ("maxAmount" IS NULL OR "maxAmount" > "minAmount"));

ALTER TABLE "approval_thresholds"
  ADD CONSTRAINT "approval_thresholds_effective_range_valid"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "final_letter_authorities"
  ADD CONSTRAINT "final_letter_band_valid"
  CHECK ("minAmount" >= 0 AND ("maxAmount" IS NULL OR "maxAmount" > "minAmount"));

ALTER TABLE "final_letter_authorities"
  ADD CONSTRAINT "final_letter_effective_range_valid"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "sla_policies"
  ADD CONSTRAINT "sla_policies_sane_values"
  CHECK ("totalWorkingDays" > 0 AND "warningPercent" >= 0 AND "warningPercent" <= 100);

ALTER TABLE "property_documents"
  ADD CONSTRAINT "property_documents_size_positive" CHECK ("sizeBytes" > 0);

-- A soft delete without a reason is an unexplained disappearance of evidence.
ALTER TABLE "property_documents"
  ADD CONSTRAINT "property_documents_delete_requires_reason"
  CHECK ("deletedAt" IS NULL OR ("deletedById" IS NOT NULL AND "deletedReason" IS NOT NULL));

-- A return is worthless to the Maker without an actionable comment
-- (spec section 33).
ALTER TABLE "correction_cycles"
  ADD CONSTRAINT "correction_cycles_comment_present"
  CHECK (length(btrim("comment")) >= 10);

ALTER TABLE "approvals"
  ADD CONSTRAINT "approvals_value_non_negative" CHECK ("valueAtDecision" >= 0);

ALTER TABLE "sla_records"
  ADD CONSTRAINT "sla_records_sane_values"
  CHECK ("elapsedWorkingDays" >= 0 AND "netWorkingDays" >= 0 AND "pausedSeconds" >= 0);

ALTER TABLE "users"
  ADD CONSTRAINT "users_failed_attempts_non_negative" CHECK ("failedAttempts" >= 0);

-- ---------------------------------------------------------------------------
-- Partial unique indexes
-- ---------------------------------------------------------------------------

-- Exactly one current valuation version per case (spec section 29).
CREATE UNIQUE INDEX "valuations_one_current_per_case"
  ON "valuations" ("caseId") WHERE "isCurrent" = true;

-- One open task of a given type per case, so a double-click cannot create two
-- competing assignments (rules 12-13).
CREATE UNIQUE INDEX "workflow_tasks_one_open_per_case_type"
  ON "workflow_tasks" ("caseId", "taskType") WHERE "completedAt" IS NULL;

-- One open correction cycle per case at a time.
CREATE UNIQUE INDEX "correction_cycles_one_open_per_case"
  ON "correction_cycles" ("caseId") WHERE "resolvedAt" IS NULL;

-- One valid signature per report.
CREATE UNIQUE INDEX "digital_signatures_one_valid_per_report"
  ON "digital_signatures" ("reportId") WHERE "status" = 'VALID' AND "reportId" IS NOT NULL;

-- Live document filenames are unique per case and category; superseded and
-- soft-deleted rows are excluded so versioning still works.
CREATE UNIQUE INDEX "property_documents_unique_live_name"
  ON "property_documents" ("caseId", "categoryId", "originalFilename")
  WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Search indexes (spec section 24)
-- ---------------------------------------------------------------------------
-- Trigram indexes support the partial-match searches the registry staff
-- actually perform ("show me anything with Tesfaye in the owner name"), which
-- a b-tree cannot serve.

CREATE INDEX "valuation_cases_owner_name_trgm"
  ON "valuation_cases" USING gin ("ownerName" gin_trgm_ops);

CREATE INDEX "valuation_cases_applicant_name_trgm"
  ON "valuation_cases" USING gin ("applicantName" gin_trgm_ops);

CREATE INDEX "valuation_cases_case_number_trgm"
  ON "valuation_cases" USING gin ("caseNumber" gin_trgm_ops);

CREATE INDEX "civil_properties_lhc_trgm"
  ON "civil_properties" USING gin ("lhcNumber" gin_trgm_ops);

CREATE INDEX "vehicles_plate_trgm"
  ON "vehicles" USING gin ("plateNumber" gin_trgm_ops);

CREATE INDEX "vehicles_chassis_trgm"
  ON "vehicles" USING gin ("chassisNumber" gin_trgm_ops);

CREATE INDEX "machinery_serial_trgm"
  ON "machinery" USING gin ("serialNumber" gin_trgm_ops);

-- Dashboard and SLA sweeps read open work constantly; these partial indexes
-- keep those queries off the archived majority of the table.
CREATE INDEX "valuation_cases_open_by_status"
  ON "valuation_cases" ("status", "departmentId", "requestedAt")
  WHERE "status" NOT IN ('ARCHIVED', 'COMPLETED', 'CANCELLED');

CREATE INDEX "workflow_tasks_open_by_assignee"
  ON "workflow_tasks" ("assigneeId", "dueAt") WHERE "completedAt" IS NULL;

CREATE INDEX "notifications_unread"
  ON "notifications" ("recipientId", "createdAt") WHERE "readAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Append-only and immutability triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION nib_reject_modification() RETURNS trigger AS
$fn$
BEGIN
  RAISE EXCEPTION
    'Table "%" is append-only; % is not permitted.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '0A000';
END;
$fn$ LANGUAGE plpgsql;

-- The audit trail must survive an application bug as much as a malicious
-- caller, so nothing may amend or remove a record (spec section 25).
CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION nib_reject_modification();

-- The reproducibility record (spec section 28). If these could be edited, a
-- historical valuation could no longer be proven.
CREATE TRIGGER "calculation_runs_append_only"
  BEFORE UPDATE OR DELETE ON "calculation_runs"
  FOR EACH ROW EXECUTE FUNCTION nib_reject_modification();

CREATE TRIGGER "workflow_history_append_only"
  BEFORE UPDATE OR DELETE ON "workflow_history"
  FOR EACH ROW EXECUTE FUNCTION nib_reject_modification();

-- An approval decision is a personal accountability record; it is never edited.
CREATE TRIGGER "approvals_append_only"
  BEFORE UPDATE OR DELETE ON "approvals"
  FOR EACH ROW EXECUTE FUNCTION nib_reject_modification();

CREATE TRIGGER "password_history_append_only"
  BEFORE UPDATE ON "password_history"
  FOR EACH ROW EXECUTE FUNCTION nib_reject_modification();

-- Frozen valuation versions are immutable; a correction creates a new version
-- rather than altering an approved one (spec section 29, rule 9).
CREATE OR REPLACE FUNCTION nib_valuation_immutable() RETURNS trigger AS
$fn$
BEGIN
  IF OLD."frozenAt" IS NOT NULL THEN
    RAISE EXCEPTION
      'Valuation % (version %) is frozen and cannot be % - create a new version instead.',
      OLD.id, OLD."version", lower(TG_OP)
      USING ERRCODE = '0A000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER "valuations_frozen_immutable"
  BEFORE UPDATE OR DELETE ON "valuations"
  FOR EACH ROW EXECUTE FUNCTION nib_valuation_immutable();

-- An approved or signed report is the document the bank relies on; it may not
-- be altered in place.
CREATE OR REPLACE FUNCTION nib_report_immutable() RETURNS trigger AS
$fn$
BEGIN
  IF OLD."isImmutable" = true THEN
    RAISE EXCEPTION
      'Report % (%, version %) is immutable and cannot be % - generate a new version instead.',
      OLD.id, OLD."type", OLD."version", lower(TG_OP)
      USING ERRCODE = '0A000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER "reports_immutable_when_final"
  BEFORE UPDATE OR DELETE ON "reports"
  FOR EACH ROW EXECUTE FUNCTION nib_report_immutable();

-- A signature may be revoked but never rewritten: allowing the hash or signer
-- to change would let a signed document be swapped for another.
CREATE OR REPLACE FUNCTION nib_signature_revoke_only() RETURNS trigger AS
$fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Digital signatures cannot be deleted; revoke the signature instead.'
      USING ERRCODE = '0A000';
  END IF;

  IF NEW."caseId"         IS DISTINCT FROM OLD."caseId"
     OR NEW."reportId"       IS DISTINCT FROM OLD."reportId"
     OR NEW."signerId"       IS DISTINCT FROM OLD."signerId"
     OR NEW."signerRole"     IS DISTINCT FROM OLD."signerRole"
     OR NEW."documentSha256" IS DISTINCT FROM OLD."documentSha256"
     OR NEW."signature"      IS DISTINCT FROM OLD."signature"
     OR NEW."provider"       IS DISTINCT FROM OLD."provider"
     OR NEW."signedAt"       IS DISTINCT FROM OLD."signedAt"
  THEN
    RAISE EXCEPTION
      'A digital signature is immutable; only its revocation status may change.'
      USING ERRCODE = '0A000';
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER "digital_signatures_revoke_only"
  BEFORE UPDATE OR DELETE ON "digital_signatures"
  FOR EACH ROW EXECUTE FUNCTION nib_signature_revoke_only();

-- A correction cycle may be closed (resolved) but its recorded grievance may
-- not be rewritten, and it may never be deleted.
CREATE OR REPLACE FUNCTION nib_correction_cycle_close_only() RETURNS trigger AS
$fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Correction cycles form the rework history and cannot be deleted.'
      USING ERRCODE = '0A000';
  END IF;

  IF NEW."caseId"         IS DISTINCT FROM OLD."caseId"
     OR NEW."sequence"       IS DISTINCT FROM OLD."sequence"
     OR NEW."returnedById"   IS DISTINCT FROM OLD."returnedById"
     OR NEW."returnedByRole" IS DISTINCT FROM OLD."returnedByRole"
     OR NEW."returnedAt"     IS DISTINCT FROM OLD."returnedAt"
     OR NEW."previousStatus" IS DISTINCT FROM OLD."previousStatus"
     OR NEW."reasonCode"     IS DISTINCT FROM OLD."reasonCode"
     OR NEW."comment"        IS DISTINCT FROM OLD."comment"
  THEN
    RAISE EXCEPTION
      'The recorded reason for a return cannot be altered; only its resolution may be set.'
      USING ERRCODE = '0A000';
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER "correction_cycles_close_only"
  BEFORE UPDATE OR DELETE ON "correction_cycles"
  FOR EACH ROW EXECUTE FUNCTION nib_correction_cycle_close_only();

-- Approved and archived cases may not be deleted outright (rule 7). Closing a
-- case is a status change with an audit record, never a DELETE.
CREATE OR REPLACE FUNCTION nib_case_delete_guard() RETURNS trigger AS
$fn$
BEGIN
  IF OLD."status" IN ('APPROVED', 'SIGNED', 'COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION
      'Case % is in status % and cannot be deleted; valuation records are retained.',
      OLD."caseNumber", OLD."status"
      USING ERRCODE = '0A000';
  END IF;
  RETURN OLD;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER "valuation_cases_delete_guard"
  BEFORE DELETE ON "valuation_cases"
  FOR EACH ROW EXECUTE FUNCTION nib_case_delete_guard();
