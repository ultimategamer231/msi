-- Branch names from MSI (Foday, 2026-11-09): BR1 Jallah Town (the main branch), BR2 Margibi,
-- BR3 Nimba. Only the placeholder names are replaced; each branch's cash account follows its name.
update public.branches b set name = n.name
  from (values ('BR1', 'Main', 'Jallah Town Branch'), ('BR2', 'Branch 2', 'Margibi Branch'),
               ('BR3', 'Branch 3', 'Nimba Branch')) as n(code, old_name, name)
 where b.code = n.code and b.name = n.old_name;
update public.accounts a set name = 'Cash on Hand – ' || b.name
  from public.branches b
 where a.branch_id = b.id and a.is_cash and a.name in ('Cash on Hand – Main', 'Cash on Hand – Branch 2', 'Cash on Hand – Branch 3');
