# encoding: utf-8
import sys
import zipfile
import xml.etree.ElementTree as ET

path = u'C:\\Users\\storm\\Desktop\\3.1-16\u6296\u97f3\u64ad\u653e.xlsx'

try:
    with zipfile.ZipFile(path, 'r') as z:
        # Read shared strings
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            sst = ET.parse(z.open('xl/sharedStrings.xml'))
            ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in sst.getroot().findall('ns:si', ns):
                texts = si.findall('.//ns:t', ns)
                shared.append(''.join(t.text or '' for t in texts))

        # Read first sheet
        sheet_xml = None
        for name in z.namelist():
            if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                sheet_xml = name
                break

        tree = ET.parse(z.open(sheet_xml))
        ns2 = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        rows = tree.getroot().findall('.//ns:row', ns2)

        for row in rows[:6]:
            cells = row.findall('ns:c', ns2)
            row_vals = []
            for c in cells:
                t = c.get('t', '')
                v = c.find('ns:v', ns2)
                val = v.text if v is not None else ''
                if t == 's':
                    idx = int(val)
                    val = shared[idx] if idx < len(shared) else ''
                row_vals.append(val)
            print('|'.join(row_vals))

except Exception as e:
    print('ERR:', e)
