import { BusinessRuleError } from '@/lib/errors';
import { Decimal, HUNDRED, ZERO } from '@/lib/money';
import { fmt, m, nonNegative, positive, qty, r4 } from '../common';
import { fractionOf } from './buildings';
import { excelEquals } from './excel';
import type { Guideline, RatedItem, SwimmingPoolTable } from './guideline';
import type { CivilWorkInput, PricedItemOutput, QuantityItemInput } from './types';

/**
 * Works on the plot outside the buildings (CALCULATION_SPEC section 3; COST
 * APPROACH FOR COMPLETED rows 333-393): internal and plot civil works, fuel
 * station works and coffee washing site works, each at the guideline's rate.
 */

const ONE = new Decimal(1);

const percentText = (fraction: Decimal): string =>
  fraction.times(HUNDRED).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

/**
 * A swimming pool priced from its bill of quantities ('Swimming pool'!E6:E27):
 * earthworks around a pool `length` x `width` x `depth` metres with a metre of
 * working space each side, its slab and walls, the chosen wall and floor
 * finishes, and electrical and sanitary works as shares of the subtotal.
 */
export function poolCost(
  pool: SwimmingPoolTable,
  finish: SwimmingPoolTable['items'][number],
  length: Decimal,
  width: Decimal,
  depth: Decimal,
): Decimal {
  const r = pool.rates;
  const plan = length.plus(2).times(width.plus(2));
  const floor = length.times(width);
  const wallArea = length.plus(width).times(2).times(2);
  const buriedDepth = depth.plus('0.2').plus('0.25');

  const shallowVolume = plan.times('1.5');
  const deepVolume = plan.times(buriedDepth.plus('0.6')).minus(shallowVolume);

  const lines = [
    plan.times(r.siteClearance),
    shallowVolume.times(r.excavationTo150),
    deepVolume.times(r.excavation150To300),
    plan.times('0.6').times(r.fillBelowHardcore),
    plan.times(buriedDepth).minus(floor.times(buriedDepth)).times(r.fillAroundWall),
    floor.times(r.hardcore),
    plan.times('0.2').plus(shallowVolume).plus(deepVolume).times('1.25').times(r.cartAway),
    floor.times(r.groundSlab),
    wallArea.times(r.shearWall),
    floor.times(7).plus(wallArea.times(110).times('0.2')).times(r.reinforcement),
    wallArea.times(2).times('1.1').times(r.formwork),
    length.plus(width).times(2).times(buriedDepth).times(r.waterproofing),
    wallArea.times(r.plastering),
    wallArea.times(finish.wallRate),
    floor.times(finish.floorRate),
  ];
  const subtotal = lines.reduce<Decimal>((sum, line) => sum.plus(line), ZERO);
  return subtotal.times(ONE.plus(pool.electricalShare).plus(pool.sanitaryShare));
}

interface Priced {
  output: PricedItemOutput;
  amount: Decimal;
  currentAmount: Decimal;
}

function completionOf(value: string | null, progressMode: boolean, what: string): Decimal {
  return progressMode && value !== null ? fractionOf(value, `${what}: the completion`) : ONE;
}

type PoolFinish = SwimmingPoolTable['items'][number];

/**
 * The finishes every pool on the plot is priced with, as the workbook does it:
 * the 'Swimming pool' sheet reads the wall and floor finish rates once, from
 * the item on the first row of plot civil works ($B$22, $B$23 from A2), and
 * every pool's bill uses them. Where that first row is not a pool, both rates
 * are nil.
 */
function workbookPoolFinish(guideline: Guideline, civil: readonly CivilWorkInput[]): PoolFinish {
  const first = civil[0]
    ? guideline.swimmingPool.items.find((i) => excelEquals(i.name, civil[0]!.item))
    : undefined;
  return first ?? { name: '', wallFinish: null, wallRate: 0, floorFinish: null, floorRate: 0 };
}

function priceCivilWork(
  guideline: Guideline,
  input: CivilWorkInput,
  index: number,
  progressMode: boolean,
  firstRowFinish: PoolFinish,
  notes: string[],
): Priced {
  const what = `Plot civil work ${index + 1}`;
  const completion = completionOf(input.completionPercent, progressMode, what);
  const poolFinish = guideline.swimmingPool.items.find((i) => excelEquals(i.name, input.item));

  if (poolFinish) {
    if (!input.pool) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_MISSING',
        `${what}: enter the swimming pool's length, width and depth.`,
      );
    }
    const length = positive(input.pool.length, `${what}: the pool length`);
    const width = positive(input.pool.width, `${what}: the pool width`);
    const depth = positive(input.pool.depth, `${what}: the pool depth`);
    const own = guideline.fixes.poolOwnFinishes;
    const finish = own ? poolFinish : firstRowFinish;
    const amount = poolCost(guideline.swimmingPool, finish, length, width, depth);
    const ownAmount = poolCost(guideline.swimmingPool, poolFinish, length, width, depth);
    const workbookAmount = poolCost(guideline.swimmingPool, firstRowFinish, length, width, depth);
    if (!ownAmount.equals(workbookAmount)) {
      notes.push(
        own
          ? `${what}: the pool is priced with its own finishes; the Excel workbook prices every pool with the finishes of the first plot civil work, ETB ${fmt(workbookAmount)} (guideline workbook slip, corrected by switch).`
          : `${what}: as in the Excel workbook, the pool is priced with the finishes named on the first row of plot civil works${firstRowFinish.name ? '' : ', which is not a pool, so both finishes are priced at nil'}; with its own finishes it would be ETB ${fmt(ownAmount)}.`,
      );
    }
    if (finish.name && (!finish.wallFinish || !finish.floorFinish)) {
      notes.push(
        `${what}: the guideline's pool list has no rate for the ${!finish.wallFinish ? 'wall' : 'floor'} finish named in "${finish.name}", so that finish is priced at nil, as in the Excel workbook.`,
      );
    }
    const currentAmount = amount.times(completion);
    return {
      output: {
        item: poolFinish.name,
        description: input.description,
        kind: 'POOL',
        rate: r4(amount),
        quantity: r4(ONE),
        completionPercent: percentText(completion),
        amount: m(amount),
        currentAmount: m(currentAmount),
        formula: `bill of quantities for a pool ${qty(length)} x ${qty(width)} x ${qty(depth)} m`,
      },
      amount,
      currentAmount,
    };
  }

  const entry = guideline.civilWorks.items.find((i) => excelEquals(i.name, input.item));
  if (!entry) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_INVALID',
      input.item.trim()
        ? `${what}: "${input.item}" is not in the guideline's internal and plot civil works.`
        : `${what}: choose the work.`,
    );
  }
  // A lump-sum item is priced once, whatever quantity is entered.
  const quantity = entry.lumpSum ? ONE : nonNegative(input.quantity, `${what}: the quantity`);
  const amount = quantity.times(entry.rate);
  const currentAmount = amount.times(completion);
  return {
    output: {
      item: entry.name,
      description: input.description,
      kind: entry.lumpSum ? 'LUMP_SUM' : 'RATE',
      rate: r4(entry.rate),
      quantity: r4(quantity),
      completionPercent: percentText(completion),
      amount: m(amount),
      currentAmount: m(currentAmount),
      formula: entry.lumpSum
        ? `lump sum ${fmt(entry.rate)}`
        : `${qty(quantity)} x ${fmt(entry.rate)}`,
    },
    amount,
    currentAmount,
  };
}

function priceListed(
  list: readonly RatedItem[],
  listName: string,
  input: QuantityItemInput,
  index: number,
  progressMode: boolean,
): Priced {
  const what = `${listName} item ${index + 1}`;
  const entry = list.find((i) => excelEquals(i.name, input.item));
  if (!entry) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_INVALID',
      input.item.trim()
        ? `${what}: "${input.item}" is not in the guideline's ${listName.toLowerCase()} works.`
        : `${what}: choose the work.`,
    );
  }
  const quantity = nonNegative(input.quantity, `${what}: the quantity`);
  const completion = completionOf(input.completionPercent, progressMode, what);
  const amount = quantity.times(entry.rate);
  const currentAmount = amount.times(completion);
  return {
    output: {
      item: entry.name,
      description: null,
      kind: 'RATE',
      rate: r4(entry.rate),
      quantity: r4(quantity),
      completionPercent: percentText(completion),
      amount: m(amount),
      currentAmount: m(currentAmount),
      formula: `${qty(quantity)} x ${fmt(entry.rate)}`,
    },
    amount,
    currentAmount,
  };
}

export interface SiteWorksResult {
  readonly civil: PricedItemOutput[];
  readonly gasStation: PricedItemOutput[];
  readonly coffeeSite: PricedItemOutput[];
  readonly complete: { civil: Decimal; gasStation: Decimal; coffeeSite: Decimal };
  readonly current: { civil: Decimal; gasStation: Decimal; coffeeSite: Decimal };
}

export function valueSiteWorks(args: {
  guideline: Guideline;
  civil: readonly CivilWorkInput[];
  gasStation: readonly QuantityItemInput[];
  coffeeSite: readonly QuantityItemInput[];
  progressMode: boolean;
  notes: string[];
}): SiteWorksResult {
  const { guideline, progressMode, notes } = args;
  const total = (items: readonly Priced[], key: 'amount' | 'currentAmount'): Decimal =>
    items.reduce<Decimal>((sum, item) => sum.plus(item[key]), ZERO);

  const firstRowFinish = workbookPoolFinish(guideline, args.civil);
  const civil = args.civil.map((w, i) =>
    priceCivilWork(guideline, w, i, progressMode, firstRowFinish, notes),
  );
  const gas = args.gasStation.map((w, i) =>
    priceListed(guideline.gasStation.items, 'Fuel station', w, i, progressMode),
  );
  const coffee = args.coffeeSite.map((w, i) =>
    priceListed(guideline.coffeeSite.items, 'Coffee washing site', w, i, progressMode),
  );

  return {
    civil: civil.map((p) => p.output),
    gasStation: gas.map((p) => p.output),
    coffeeSite: coffee.map((p) => p.output),
    complete: {
      civil: total(civil, 'amount'),
      gasStation: total(gas, 'amount'),
      coffeeSite: total(coffee, 'amount'),
    },
    current: {
      civil: total(civil, 'currentAmount'),
      gasStation: total(gas, 'currentAmount'),
      coffeeSite: total(coffee, 'currentAmount'),
    },
  };
}
