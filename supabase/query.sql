select 'appts', a.* from appointments a 
join clinic_users cu on cu.clinic_id = a.clinic_id 
where cu.email = 'elizabeth.zibaaa@gmail.com' 
order by a.created_at desc limit 2;
