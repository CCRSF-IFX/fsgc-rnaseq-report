#!/usr/bin/env python3
"""Read simple QC tables from an Excel workbook."""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
NS = {'m': MAIN_NS, 'r': REL_NS, 'rel': PKG_REL_NS}


def load_summary_sheet(path: Path, sheet_name: str = 'Summary') -> list[dict[str, str]]:
    """Return the named worksheet as a list of row dictionaries."""
    with zipfile.ZipFile(path) as workbook:
        shared_strings = read_shared_strings(workbook)
        sheet_path = resolve_sheet_path(workbook, sheet_name)
        root = ET.fromstring(workbook.read(sheet_path))
        table = worksheet_rows(root, shared_strings)

    while table and not any(str(value).strip() for value in table[0]):
        table.pop(0)
    if not table:
        return []

    headers = [str(value).strip() for value in table[0]]
    rows = []
    for values in table[1:]:
        row = {
            header: values[index] if index < len(values) else ''
            for index, header in enumerate(headers)
            if header
        }
        if any(str(value).strip() for value in row.values()):
            rows.append(row)
    return rows


def read_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if 'xl/sharedStrings.xml' not in workbook.namelist():
        return []
    root = ET.fromstring(workbook.read('xl/sharedStrings.xml'))
    strings = []
    for item in root.findall('m:si', NS):
        strings.append(''.join(text.text or '' for text in item.findall('.//m:t', NS)))
    return strings


def resolve_sheet_path(workbook: zipfile.ZipFile, sheet_name: str) -> str:
    workbook_root = ET.fromstring(workbook.read('xl/workbook.xml'))
    rels_root = ET.fromstring(workbook.read('xl/_rels/workbook.xml.rels'))
    rels = {
        rel.attrib['Id']: rel.attrib['Target']
        for rel in rels_root.findall('rel:Relationship', NS)
    }

    for sheet in workbook_root.findall('m:sheets/m:sheet', NS):
        if sheet.attrib.get('name') != sheet_name:
            continue
        rel_id = sheet.attrib.get(f'{{{REL_NS}}}id')
        target = rels.get(rel_id or '')
        if not target:
            break
        target = target.lstrip('/')
        return target if target.startswith('xl/') else f'xl/{target}'
    raise ValueError(f'{Path(workbook.filename).name} missing Excel sheet "{sheet_name}"')


def worksheet_rows(root: ET.Element, shared_strings: list[str]) -> list[list[str]]:
    rows = []
    for row in root.findall('m:sheetData/m:row', NS):
        values = []
        for cell in row.findall('m:c', NS):
            index = column_index(cell.attrib.get('r', ''))
            while len(values) < index:
                values.append('')
            values.append(cell_value(cell, shared_strings))
        rows.append(values)
    return rows


def column_index(cell_ref: str) -> int:
    letters = re.match(r'([A-Z]+)', cell_ref.upper())
    if not letters:
        return 0
    index = 0
    for char in letters.group(1):
        index = index * 26 + ord(char) - ord('A') + 1
    return index - 1


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get('t')
    if cell_type == 'inlineStr':
        return ''.join(text.text or '' for text in cell.findall('.//m:t', NS))

    value = cell.find('m:v', NS)
    if value is None or value.text is None:
        return ''
    if cell_type == 's':
        index = int(value.text)
        return shared_strings[index] if index < len(shared_strings) else ''
    if cell_type == 'b':
        return 'TRUE' if value.text == '1' else 'FALSE'
    return value.text
