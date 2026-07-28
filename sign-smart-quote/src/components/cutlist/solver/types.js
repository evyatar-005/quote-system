/**
 * @typedef {{x:number, y:number, w:number, h:number}} Rect
 *
 * @typedef {{id:string, name:string, length:number, width:number, qty:number}} StockDef
 * @typedef {{id:string, name:string, length:number, width:number, qty:number}} PartDef
 *
 * @typedef {{id:string, name:string, length:number, width:number, remaining:number, i:number}} DemandEntry
 *
 * @typedef {{partId:string, typeIndex:number, name:string,
 *   x:number, y:number, w:number, h:number, rotated:boolean}} Placement
 *
 * @typedef {{axis:'x'|'y', pos:number, a:number, b:number, depth:number}} Cut
 *
 * @typedef {{stockId:string, stockName:string, sheetW:number, sheetH:number,
 *   placements:Placement[], freeRects:Rect[], cuts:Cut[],
 *   usedCounts:number[], placedCount:number, usedArea:number, sheetArea:number,
 *   largestOffcut:Rect|null}} SheetLayout
 *
 * @typedef {{stocks:StockDef[], parts:PartDef[], kerf:number,
 *   mode:'guillotine'|'nest'}} SolverInput
 *
 * @typedef {{id:string, name:string, count:number,
 *   reason:'TOO_LARGE'|'NO_MATERIAL'}} UnplacedEntry
 *
 * @typedef {{sheetsUsed:Object<string,number>, totalSheetArea:number,
 *   totalPartArea:number, wasteArea:number, utilization:number,
 *   totalCuts:number, totalCutLength:number, sumLargestOffcut:number}} Stats
 *
 * @typedef {{ok:boolean, mode:'guillotine'|'nest', kerf:number, seed:number,
 *   passesRun:number, elapsedMs:number, cfg:object,
 *   sheets:SheetLayout[], unplaced:UnplacedEntry[], stats:Stats,
 *   warnings:string[]}} OptimizeResult
 */

export {};
