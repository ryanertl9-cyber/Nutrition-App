#!/usr/bin/env python3
"""Slim down USDA FNDDS 2021-2023 and CDC NHANES 2021-2023 dietary recalls into small files the
app build uses (vendor/fndds/fndds.json, vendor/fndds/nhanes-counts.json).

Inputs (download once, not committed; both public domain):
  https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip  -> surveyDownload.json
  https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/DR1IFF_L.xpt
  https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/DR2IFF_L.xpt

Usage: python3 scripts/extract-fndds.py <dir with the three files>   (needs pandas for the .xpt files)
"""
import json, os, sys

NUMBERS = {  # app nutrient key -> FoodData Central nutrient number (same order as the app)
    'kcal': '208', 'protein': '203', 'fat': '204', 'carbs': '205', 'fiber': '291', 'sugar': '269',
    'satfat': '606', 'mufa': '645', 'pufa': '646', 'chol': '601', 'vitA': '320', 'vitC': '401', 'vitD': '328',
    'vitE': '323', 'vitK': '430', 'thiamin': '404', 'riboflavin': '405', 'niacin': '406', 'panto': '410', 'b6': '415',
    'folate': '435', 'b12': '418', 'choline': '421', 'calcium': '301', 'iron': '303', 'magnesium': '304',
    'phosphorus': '305', 'potassium': '306', 'sodium': '307', 'zinc': '309', 'copper': '312', 'manganese': '315', 'selenium': '317',
}

def main(src):
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out_dir = os.path.join(root, 'vendor', 'fndds')
    os.makedirs(out_dir, exist_ok=True)

    foods = json.load(open(os.path.join(src, 'surveyDownload.json')))['SurveyFoods']
    slim = []
    for f in foods:
        if not f['foodNutrients']:
            continue  # e.g. "Milk, human" has no values
        by_num = {n['nutrient']['number']: n.get('amount') for n in f['foodNutrients']}
        vals = [by_num.get(NUMBERS[k]) for k in NUMBERS]
        portions = []
        typical = None
        for p in sorted(f.get('foodPortions', []), key=lambda p: p.get('sequenceNumber', 0)):
            g, desc = p.get('gramWeight') or 0, (p.get('portionDescription') or '').strip()
            if g <= 0 or not desc:
                continue
            if desc.lower() == 'quantity not specified':
                typical = [g, '1 typical serving']
                continue
            portions.append([g, desc])
        if typical:
            portions.append(typical)
        ingredients = [[int(i['ingredientCode']), float(i['ingredientWeight'])] for i in f.get('inputFoods', []) if i.get('ingredientCode') and i.get('ingredientWeight')]
        slim.append({
            'code': int(f['foodCode']), 'name': f['description'],
            'category': (f.get('wweiaFoodCategory') or {}).get('wweiaFoodCategoryDescription', ''),
            'vals': vals, 'portions': portions, 'ingredients': ingredients,
        })
    json.dump({'source': 'USDA Food and Nutrient Database for Dietary Studies (FNDDS) 2021-2023', 'nutrients': list(NUMBERS), 'foods': slim},
              open(os.path.join(out_dir, 'fndds.json'), 'w'), separators=(',', ':'))

    import pandas as pd
    counts = {}
    for fname, code, weight in [('DR1IFF_L.xpt', 'DR1IFDCD', 'WTDRD1'), ('DR2IFF_L.xpt', 'DR2IFDCD', 'WTDR2D')]:
        df = pd.read_sas(os.path.join(src, fname), format='xport', encoding='latin-1')
        g = df.groupby(code).agg(n=(code, 'size'), w=(weight, 'sum'))
        for k, row in g.iterrows():
            c = counts.setdefault(str(int(k)), [0, 0.0])
            c[0] += int(row.n)
            c[1] += float(row.w) if row.w == row.w else 0.0
    json.dump({'source': 'CDC NHANES 2021-2023 dietary recalls (days 1 and 2): [reports, survey-weighted reports]',
               'counts': {k: [v[0], round(v[1])] for k, v in counts.items()}},
              open(os.path.join(out_dir, 'nhanes-counts.json'), 'w'), separators=(',', ':'))
    print(f'{len(slim)} FNDDS foods, {len(counts)} food codes with NHANES reports')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
