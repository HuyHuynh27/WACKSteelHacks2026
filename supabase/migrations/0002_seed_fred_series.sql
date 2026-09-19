-- Candidate FRED series the Claude mapper chooses from.
--
-- Every id, title and unit below was checked against fred.stlouisfed.org.
-- Re-check after editing: `python ingestion/verify_catalog.py`.
-- The mapper may also adopt new series from the FRED search API at runtime.

insert into public.fred_series (series_id, title, units, frequency, keywords) values
  -- Metals -----------------------------------------------------------------
  ('PALUMUSDM',    'Global price of Aluminum',                                  'USD per Metric Ton',  'Monthly',   array['aluminum','aluminium','alloy','ingot','extrusion','6061']),
  ('PCOPPUSDM',    'Global price of Copper',                                    'USD per Metric Ton',  'Monthly',   array['copper','cathode','wire','busbar']),
  ('PNICKUSDM',    'Global price of Nickel',                                    'USD per Metric Ton',  'Monthly',   array['nickel','stainless','304','316']),
  ('PZINCUSDM',    'Global price of Zinc',                                      'USD per Metric Ton',  'Monthly',   array['zinc','galvanize','galvanized','diecast']),
  ('PLEADUSDM',    'Global price of Lead',                                      'USD per Metric Ton',  'Monthly',   array['lead','battery','counterweight']),
  ('PTINUSDM',     'Global price of Tin',                                       'USD per Metric Ton',  'Monthly',   array['tin','solder','tinplate']),
  ('PIORECRUSDM',  'Global price of Iron Ore',                                  'USD per Metric Ton',  'Monthly',   array['iron','ore','pellet','steelmaking']),
  ('WPU101',       'PPI: Metals and Metal Products: Iron and Steel',            'Index 1982=100',      'Monthly',   array['steel','iron','sheet','plate','rebar','coil','tube','angle']),
  ('WPU102',       'PPI: Metals and Metal Products: Nonferrous Metals',         'Index 1982=100',      'Monthly',   array['nonferrous','brass','bronze','titanium','magnesium']),

  -- Plastics, chemicals, rubber --------------------------------------------
  ('WPU072',       'PPI: Rubber and Plastic Products: Plastic Products',        'Index 1982=100',      'Monthly',   array['plastic','resin','polymer','pet','hdpe','abs','polypropylene','injection']),
  ('WPU061',       'PPI: Chemicals and Allied Products: Industrial Chemicals',  'Index 1982=100',      'Monthly',   array['chemical','solvent','acid','adhesive','coating','industrial']),
  ('PRUBBUSDM',    'Global price of Rubber',                                    'US Cents per Pound',  'Monthly',   array['rubber','latex','elastomer','gasket','seal','tire']),

  -- Paper, wood, textiles, glass, cement -----------------------------------
  ('WPU0911',      'PPI: Pulp, Paper, and Allied Products: Wood Pulp',          'Index 1982=100',      'Monthly',   array['paper','pulp','cardboard','carton','corrugated','packaging','label']),
  ('WPU081',       'PPI: Lumber and Wood Products: Lumber',                     'Index 1982=100',      'Monthly',   array['lumber','wood','timber','plywood','board','pallet']),
  ('WPU03',        'PPI: Textile Products and Apparel',                         'Index 1982=100',      'Monthly',   array['textile','fabric','apparel','cloth','yarn','webbing','thread']),
  ('WPU1311',      'PPI: Nonmetallic Mineral Products: Flat Glass',             'Index 1982=100',      'Monthly',   array['glass','flat glass','window','pane','glazing']),
  ('PCU32733273',  'PPI: Cement and Concrete Product Manufacturing',            'Index Dec 2003=100',  'Monthly',   array['cement','concrete','aggregate','mortar','precast']),

  -- Agricultural and food inputs -------------------------------------------
  ('PCOTTINDUSDM', 'Global price of Cotton',                                    'US Cents per Pound',  'Monthly',   array['cotton','fiber','fibre','yarn','canvas']),
  ('PWHEAMTUSDM',  'Global price of Wheat',                                     'USD per Metric Ton',  'Monthly',   array['wheat','flour','grain','bakery','dough']),
  ('PMAIZMTUSDM',  'Global price of Corn',                                      'USD per Metric Ton',  'Monthly',   array['corn','maize','starch','syrup','cornmeal']),
  ('PSOYBUSDQ',    'Global price of Soybeans',                                  'USD per Metric Ton',  'Quarterly', array['soy','soybean','soybeans','lecithin']),
  ('PSUGAISAUSDM', 'Global price of Sugar, No. 11, World',                      'US Cents per Pound',  'Monthly',   array['sugar','sucrose','sweetener','cane']),
  ('PCOFFOTMUSDM', 'Global price of Coffee, Other Mild Arabica',                'US Cents per Pound',  'Monthly',   array['coffee','arabica','bean','roast','espresso']),
  ('PCOCOUSDM',    'Global price of Cocoa',                                     'USD per Metric Ton',  'Monthly',   array['cocoa','cacao','chocolate','couverture']),
  ('PPOULTUSDM',   'Global price of Poultry',                                   'US Cents per Pound',  'Monthly',   array['poultry','chicken','meat']),
  ('PBEEFUSDQ',    'Global price of Beef',                                      'US Cents per Pound',  'Quarterly', array['beef','cattle','meat']),
  ('APU0000708111','Average Price: Eggs, Grade A, Large, US City Average',       'USD per Dozen',       'Monthly',   array['egg','eggs','albumen']),
  ('APU0000709112','Average Price: Milk, Fresh, Whole, Fortified, US City Avg',  'USD per Gallon',      'Monthly',   array['milk','dairy','cream','butterfat']),

  -- Energy and freight — an input cost for nearly everyone -----------------
  ('DCOILWTICO',   'Crude Oil Prices: West Texas Intermediate (WTI)',           'USD per Barrel',      'Daily',     array['oil','crude','petroleum','diesel','freight','shipping']),
  ('DHHNGSP',      'Henry Hub Natural Gas Spot Price',                          'USD per MMBTU',       'Daily',     array['gas','natural gas','energy','power','kiln','heating']),
  ('GASREGW',      'US Regular All Formulations Gas Price',                     'USD per Gallon',      'Weekly',    array['gasoline','fuel','delivery','trucking'])
on conflict (series_id) do nothing;
