
import { createZip } from 'littlezip';
import { xmlesc, cellRef, excelDate } from './utils';
import { contentTypesXml, relsXml, theme1Xml, stylesXml, workbookXmlRels } from './xlsx-static';
import appxml from './xlsx-dynamic/appxml';
import corexml from './xlsx-dynamic/corexml';
import workbookxml from './xlsx-dynamic/workbookxml';

export enum XlsxDataTypes {
  Number,
  String,
  DateTime,
  Date,
  Time,
}

interface XlsxConfig {
  headings: string[];
  types: XlsxDataTypes[];
  data: any[][];
  freeze: boolean;
  autoFilter: boolean;
  sheetName: string;
  creator: string;
  title: string;
  description: string;
  company: string;
}

const timeTypes = {
  [XlsxDataTypes.Time]: true,
  [XlsxDataTypes.Date]: true,
  [XlsxDataTypes.DateTime]: true,
};

const typeWidths = {  // these include padWidth
  [XlsxDataTypes.Time]: 10,
  [XlsxDataTypes.Date]: 12,
  [XlsxDataTypes.DateTime]: 20,
}

const minColWidth = 6; // includes padWidth
const maxColWidth = 42;  // includes padWidth
const padWidth = 2;
const stringCharWidth = 1.6;
const maxColStringChars = Math.ceil(maxColWidth / stringCharWidth) - padWidth;
const maxColNumberChars = maxColWidth - padWidth;

export const createXlsx = ({ headings, types, data, creator, title, description, sheetName, company, freeze, autoFilter }: XlsxConfig) => {
  const cols = headings.length;
  if (cols !== types.length || cols !== data[0].length) throw new Error('Number of headings, types and data columns must match');

  const rows = data.length;
  const creationDate = new Date();

  const sharedStrings = new Map();
  let totalStringCount = 0;
  let uniqueStringCount = 0;

  const colWidths = [];

  // start with heading lengths, clamped to min and max
  const headingPadWidth = padWidth + (autoFilter ? 3 : 0);
  for (let colIndex = 0; colIndex < cols; colIndex++) {
    const heading = headings[colIndex];
    const headingWidth = heading.length * stringCharWidth + headingPadWidth;
    colWidths[colIndex] =
      headingWidth < minColWidth ? minColWidth :
        headingWidth > maxColWidth ? maxColWidth :
          headingWidth;
  }

  // update for data rows
  for (let colIndex = 0; colIndex < cols; colIndex++) {
    // if already at max width from column name, skip
    if (colWidths[colIndex] >= maxColWidth) continue;

    // check if there's a type-defined width
    const type = types[colIndex]
    const typeWidth = typeWidths[type as keyof typeof typeWidths];
    if (typeWidth !== undefined) {
      if (colWidths[colIndex] < typeWidth) colWidths[colIndex] = typeWidth;
      continue;  // no need to check multiple rows
    }

    // for a string column, check max line length within all strings
    if (type === XlsxDataTypes.String) {
      let longestLineLength = 0;
      for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const cell = data[rowIndex][colIndex];
        let lastNewlineIndex = -1;
        let newlineIndex;
        let cellChars = cell.length;
        for (; ;) {
          newlineIndex = cell.indexOf('\n', lastNewlineIndex + 1);
          if (newlineIndex === -1) newlineIndex = cellChars;
          const lineLength = newlineIndex - lastNewlineIndex;
          if (lineLength > longestLineLength) longestLineLength = lineLength;
          if (newlineIndex === cellChars) break;
          lastNewlineIndex = newlineIndex;
        }
        if (longestLineLength >= maxColStringChars) break;
      }
      const colWidth = longestLineLength * stringCharWidth + padWidth;
      if (colWidths[colIndex] < colWidth) colWidths[colIndex] = colWidth > maxColWidth ? maxColWidth : colWidth;

    // check max number length
    } else if (type === XlsxDataTypes.Number) {
      let longestNumLength = 0;
      for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const numLength = data[rowIndex][colIndex].length;
        if (numLength > longestNumLength) longestNumLength = numLength;
        if (longestNumLength >= maxColNumberChars) break;
      }
      const colWidth = longestNumLength + padWidth;
      if (colWidths[colIndex] < colWidth) colWidths[colIndex] = colWidth > maxColWidth ? maxColWidth : colWidth;
    }
  }

  const colsXml = `<cols>${colWidths.map(
    (colWidth, colIndex) => `<col min="${colIndex + 1}" max="${colIndex + 1}" width="${colWidth}" bestFit="1" customWidth="1" />`).join('')
    }</cols>`;

  const headingsXml = `<row r="1" spans="1:${cols}">${headings.map(
    (cell, colIndex) => `<c r="${cellRef(colIndex, 0)}" t="inlineStr" s="1"><is><t>${xmlesc(cell)}</t></is></c>`)
    .join('')}</row>`;

  const rowsXml = `${data.map((row, rowIndex) => `<row r="${rowIndex + 2}" spans="1:${cols}">${row.map(
    (cell, colIndex) => {
      const type = types[colIndex];
      let styleIndex;
      if (type in timeTypes) {
        if (type === XlsxDataTypes.Time) {
          styleIndex = 4;
          const [h, m, s] = cell.split(':').map((x: string) => +x);
          cell = new Date(Date.UTC(1900, 0, 1, h, m, s));

        } else if (type === XlsxDataTypes.Date) {
          styleIndex = 3;
          cell = new Date(Date.parse(cell));

        } else {  // DateTime
          styleIndex = 2;
          cell = new Date(Date.parse(cell));
        }
        // for dates before 1 Jan 1900, we fall back to a string representation
        cell = excelDate(cell) ?? cell;
        if (typeof cell === 'string') type === XlsxDataTypes.String;
      }
      if (type === XlsxDataTypes.String) {
        totalStringCount++;
        let stringIndex = sharedStrings.get(cell);
        if (stringIndex === undefined) {
          stringIndex = uniqueStringCount;
          sharedStrings.set(cell, stringIndex);
          uniqueStringCount++;
        }
        return `<c r="${cellRef(colIndex, rowIndex + 1)}" t="s"><v>${stringIndex}</v></c>`;
        // return `<c r="${cellRef(colIndex, rowIndex + 1)}" t="inlineStr"><is><t>${xmlesc(cell)}</t></is></c>`;
      }
      return `<c r="${cellRef(colIndex, rowIndex + 1)}"${styleIndex ? ` s="${styleIndex}"` : ''}><v>${cell}</v></c>`;
    }
  ).join('')}</row>`).join('')}`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${totalStringCount}" uniqueCount="${uniqueStringCount}">
${[...sharedStrings].map(([k]) => `<si><t>${xmlesc(k)}</t></si>`).join('')}
</sst>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet 
  xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  mc:Ignorable="xr"
  xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"
  xr:uid="{${crypto.randomUUID()}}">
  <dimension ref="A1:${cellRef(cols - 1, rows)}" />
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      ${freeze ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen" />` : ''}
      <selection${freeze ? ` pane="bottomLeft"` : ''} activeCell="A2" sqref="A2" />
    </sheetView>
  </sheetViews>
  <sheetFormatPr baseColWidth="12" defaultRowHeight="16" />
${colsXml}
  <sheetData>
${headingsXml}
${rowsXml}
  </sheetData>
  ${autoFilter ? `<autoFilter ref="A1:${cellRef(cols - 1, 0)}" xr:uid="{3${crypto.randomUUID()}}" />` : ''}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3" />
</worksheet>`;

  console.log(sharedStringsXml, sheetXml);
  return createZip([
    { path: '[Content_Types].xml', data: contentTypesXml },
    { path: '_rels/.rels', data: relsXml },
    { path: 'xl/_rels/workbook.xml.rels', data: workbookXmlRels },
    { path: 'xl/workbook.xml', data: workbookxml({ sheetName }) },
    { path: 'xl/styles.xml', data: stylesXml },
    { path: 'xl/theme/theme1.xml', data: theme1Xml },
    { path: 'xl/sharedStrings.xml', data: sharedStringsXml },
    { path: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { path: 'docProps/core.xml', data: corexml({ title, description, creator, creationDate }) },
    { path: 'docProps/app.xml', data: appxml({ company }) },
  ]);
};
