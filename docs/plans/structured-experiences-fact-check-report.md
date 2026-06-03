> **Tracked copy (issue 06).** Source: the fact-check workflow output at
> `.scratch/structured-experiences/fact-check-report.md` (gitignored). Committed
> here so the claim→verdict→source trail survives outside `.scratch`.
>
> **Two existing-row corrections applied to `db/seed-extras.ts`** (from
> `.scratch/structured-experiences/existing-audit.json`):
>
> 1. **Markha Valley** (`leh-ladakh-trekking-markha-valley-6d`) — permit fixed:
>    requires a **Hemis National Park / Wildlife Department entry permit**, NOT an
>    Inner Line Permit (ILP is for border zones: Nubra, Pangong, Tso Moriri). The
>    `requiredPermits` array and the "Inner Line Permit" mention in the prose were
>    both corrected. Nubra and Pangong keep ILP; Zanskar rafting kept as-is.
> 2. **Zanskar rafting** (`leh-ladakh-rafting-zanskar-grade-iv`) — distance fixed
>    from ~26 km to **~28 km** in the short and long descriptions.

---

# Outvers demo-catalog fact-check report

> dev-only demo catalog, web-fact-checked; issue 06 bounded pilot

**Summary:** 30 new listings authored across 10 regions; 150 claims checked (138 on new listings + 12 on the existing catalog); 48 claims corrected or refuted (46 on new listings, 2 on the existing catalog).

## New listings — claims

### Rishikesh (13 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `rishikesh-shivpuri-nim-beach-16km-rafting` | The Shivpuri-to-NIM-Beach run is ~16 km with seven rapids including Roller Coaster (III+), Golf Course (III+) and Club House (III), grades I to III+. | verified | https://whiteworldexpeditions.com/tour/shivpuri-down-rafting-in-rishikesh-sdr-nb-16/ |
| `rishikesh-shivpuri-nim-beach-16km-rafting` | Season is months [10,11,2,3,4,5,6] (Oct, Nov, Feb-Jun). | corrected | https://whiteworldexpeditions.com/tour/shivpuri-down-rafting-in-rishikesh-sdr-nb-16/ |
| `rishikesh-shivpuri-nim-beach-16km-rafting` | Shivpuri base is on NH-7 (Badrinath Road), 16 km from Rishikesh. | corrected | https://www.facebook.com/groups/hvkumar/posts/10154808935079565/ |
| `rishikesh-shivpuri-nim-beach-16km-rafting` | Minimum age 14; no special permit required (permits: []). | verified | https://whiteworldexpeditions.com/tour/shivpuri-down-rafting-in-rishikesh-sdr-nb-16/ |
| `rishikesh-shivpuri-nim-beach-16km-rafting` | Operator-plausible pricing of 1600/1300/1050 per person by group size. | verified | https://whiteworldexpeditions.com/tour/shivpuri-down-rafting-in-rishikesh-sdr-nb-16/ |
| `rishikesh-kunjapuri-sunrise-temple-trek` | Kunjapuri Devi temple sits at 1,676 m and is one of the 52 Shakti Peeths. | verified | https://himalayashelter.com/trek/kunjapuri-temple-trek |
| `rishikesh-kunjapuri-sunrise-temple-trek` | Trailhead is Hindola Khal with a 4-5 km forest trail, finishing with ~300 stone steps to the temple. | verified | https://thinairexpedition.com/kunjapuri-temple-trek |
| `rishikesh-kunjapuri-sunrise-temple-trek` | Summit views include Bandarpunch, Gangotri and Chaukhamba peaks. | verified | https://planyourpackage.com/blogs/kunjapuri-temple-sunrise-trek-timing-guide/ |
| `rishikesh-kunjapuri-sunrise-temple-trek` | Minimum age 8. | corrected | https://planyourpackage.com/blogs/kunjapuri-temple-sunrise-trek-timing-guide/ |
| `rishikesh-kunjapuri-sunrise-temple-trek` | No special permit required (permits: []) and ~30 km drive from Tapovan to trailhead. | verified | https://himalayandreamtreks.in/trek/kunjapuri-temple-trek/ |
| `rishikesh-neergarh-waterfall-rappelling-rock-climb` | Activity is based at a 'Mohanchatti adventure base, NH-7 near Mohanchatti, ~25 km from Rishikesh', with a ~30-minute hike to Neer Garh waterfall on the Badrinath highway side. | refuted | https://www.tripadvisor.com/Attraction_Review-g580106-d7598673-Reviews-Neer_Garh_Waterfall-Rishikesh_Dehradun_District_Uttarakhand.html |
| `rishikesh-neergarh-waterfall-rappelling-rock-climb` | Top-rope climbing on natural Shivalik faces plus waterfall rappelling at Neer Garh is a real, offered activity near Rishikesh. | verified | https://campinginrishikesh.in/activity/rock-climbing-and-rappelling-in-rishikesh/ |
| `rishikesh-neergarh-waterfall-rappelling-rock-climb` | No special permit required (permits: []). | verified | https://campinginrishikesh.in/activity/rock-climbing-and-rappelling-in-rishikesh/ |

### Manali (13 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `manali-bhrigu-lake-trek-3d` | Bhrigu Lake sits at 4,300 m / 14,100 ft near Manali. | verified | https://himalayanfrontiers.com/blog/how-to-reach-the-basecamp-of-bhrigu-lake-trek-from-gulaba-village |
| `manali-bhrigu-lake-trek-3d` | Gulaba is the roadhead ~22 km from Manali, ~2 hr drive, trek to Rola Kholi (~3,500 m). | verified | https://himtrek.co.in/activity/bhrigu-lake-trek-from-gulaba/ |
| `manali-bhrigu-lake-trek-3d` | Best mid-May to October (seasonMonths 5-10); meadows open within the first hour. | corrected | https://indiahikes.com/bhrigu-lake |
| `manali-bhrigu-lake-trek-3d` | No Inner Line Permit required; a forest-department trekking permit applies (permits array empty). | verified | https://refuje.com/blog/himachal-pradesh-permits-2026-guide |
| `manali-bhrigu-lake-trek-3d` | Summit-day views of Hanuman Tibba, Seven Sisters and the Dhauladhar range. | corrected | https://himtrek.co.in/activity/bhrigu-lake-trek-from-gulaba/ |
| `manali-beas-rafting-pirdi-jhiri` | Pirdi to Jhiri is roughly a 14 km rafting stretch. | verified | https://www.tripoto.com/india/trips/river-rafting-in-rishikesh-kullu-valley |
| `manali-beas-rafting-pirdi-jhiri` | The run is Grade III white water (title said '14 km Grade III'). | corrected | https://www.moxtain.com/blogs/river-rafting-in-manali |
| `manali-beas-rafting-pirdi-jhiri` | Named rapids on this stretch include Big Brother, Sumo and the Wall. | refuted | https://www.facebook.com/groups/1528556590661443/posts/3126906907493062/ |
| `manali-beas-rafting-pirdi-jhiri` | July to mid-September is closed for high water. | corrected | https://allblogs.in/post/white-water-rafting-kullu-manali |
| `manali-beas-rafting-pirdi-jhiri` | Around 45 minutes from Manali by road. | corrected | https://avianexperiences.com/attractions/river-rafting-in-manali |
| `manali-aleo-crag-rock-climbing` | Aleo is clean granite, 3 km south of Manali, set in cedar forest. | verified | https://ascentdescentadventures.com/blog/rock-climbing-in-aleo-manali/ |
| `manali-aleo-crag-rock-climbing` | Around 25 bolted sport routes plus a few trad lines. | corrected | https://www.thecrag.com/en/climbing/india/area/2592753993 |
| `manali-aleo-crag-rock-climbing` | Grade 5 upward with steeper 6a–6b lines; best March–June and September–November. | verified | https://www.thecrag.com/en/climbing/india/area/2592753993 |

### Bir Billing (16 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `bir-billing-first-flight-tandem-monastery-view` | Billing take-off sits at ~2,400 m and Bir landing at ~1,400 m | verified | https://birbillingparagliding.com/blog/bir-billing-paragliding-take-off/ |
| `bir-billing-first-flight-tandem-monastery-view` | Best paragliding season is Oct-Nov and Mar-Jun (months 3,4,5,6,10,11) | verified | https://birbillingparagliding.com/blog/paragliding-season-in-bir-billing/ |
| `bir-billing-first-flight-tandem-monastery-view` | Chokling and Sherab Ling monasteries are visible landmarks near Bir | verified | https://en.wikipedia.org/wiki/Bir_Tibetan_Colony |
| `bir-billing-first-flight-tandem-monastery-view` | Standard beginner tandem (15-20 min) priced ~Rs 2,500-2,900 per person | verified | https://madtrek.com/product/paragliding-bir-billing/ |
| `bir-billing-first-flight-tandem-monastery-view` | durationMinutes total experience = 180 min | corrected | internal consistency check vs itinerary (45+45+30) |
| `bir-billing-first-flight-tandem-monastery-view` | Minimum age 12 for tandem; no Inner Line Permit needed | verified | https://birbillingparagliding.com/blog/age-restrictions-for-paragliding/ |
| `bir-billing-thamsar-pass-bara-bhangal-crossing` | Thamsar Pass altitude is 4,665 m | corrected | https://hpkangra.nic.in/tourist-place/thamsar-pass-trek/ |
| `bir-billing-thamsar-pass-bara-bhangal-crossing` | Bara Bhangal village sits at ~2,500 m | corrected | https://www.facebook.com/groups/themountainscalling/posts/10163654782705775/ |
| `bir-billing-thamsar-pass-bara-bhangal-crossing` | Lantern Peak and Thamsar Peak (both above 5,000 m) flank the route | verified | https://www.tripoto.com/himachal-pradesh/trips/a-tyrst-with-dhauladhars-the-white-mountains-5db4092513a7f |
| `bir-billing-thamsar-pass-bara-bhangal-crossing` | Route via Rajgundha, Johdi waterfall, Panhartu, Bhedpal camps | corrected | https://hpkangra.nic.in/tourist-place/thamsar-pass-trek/ |
| `bir-billing-thamsar-pass-bara-bhangal-crossing` | Pass links Kangra and Ravi valleys | corrected | https://hpkangra.nic.in/tourist-place/thamsar-pass-trek/ |
| `bir-billing-thamsar-pass-bara-bhangal-crossing` | 5-day duration and extreme difficulty; no traveler permit beyond operator-handled forest entry | verified | https://himtrek.co.in/activity/thamsar-pass-trek/ |
| `bir-billing-gunehar-forest-riverside-camp` | Gunehar waterfall is ~100 ft tall | verified | https://www.facebook.com/musafirjunction/posts/... |
| `bir-billing-gunehar-forest-riverside-camp` | Gunehar village is ~1.5 km below Bir at roughly 1,400 m | corrected | https://www.themoonshine.in/post/gunehar-hidden-waterfall-bir-billing-s-most-peaceful-escape-a-complete-guide |
| `bir-billing-gunehar-forest-riverside-camp` | Season runs spring through autumn (months 3,4,5,6,9,10,11) | verified | https://www.themoonshine.in/post/gunehar-hidden-waterfall-bir-billing-s-most-peaceful-escape-a-complete-guide |
| `bir-billing-gunehar-forest-riverside-camp` | Chokling monastery and Bir Tibetan Colony reachable on an optional morning stroll | verified | https://en.wikipedia.org/wiki/Bir_Tibetan_Colony |

### Goa (12 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `goa-candolim-discover-scuba-try-dive` | A guided walk-in shore dive off Bambolim Beach, descending to 4-6 m in the bay shallows to see damselfish, sergeant majors and rock lobsters among the rocks. | refuted | https://www.padi.com/diving-in/goa/ |
| `goa-candolim-discover-scuba-try-dive` | Dive season in Goa runs October to May. | verified | https://www.goasathi.com/blog/best-time-of-year-for-scuba-diving-at-grand-island |
| `goa-candolim-discover-scuba-try-dive` | Beginner intro-dive pricing of roughly Rs 2600-3200 per person is operator-plausible. | verified | https://www.instagram.com/reel/CbmZ1lVqdjN/ |
| `goa-candolim-discover-scuba-try-dive` | Candolim/Calangute area is a real Goa scuba dive-base hub for beginner sessions. | verified | https://www.tripadvisor.com/AttractionProductReview-g306995-d19146385-Flying_Fish_Scuba_Diving_Resort_Explore_Scuba_Dive-Calangute_North_Goa_District_Go.html |
| `goa-sal-river-sunset-paddle` | Cavelossim and Mobor are real South Goa locations on the Sal river, with Mobor at the river mouth where the Sal meets the Arabian Sea. | verified | https://www.gomantaktimes.com/ampstories/web-stories/visit-south-goas-mobor-where-the-sal-meets-the-sea |
| `goa-sal-river-sunset-paddle` | The lower Sal is a calm, beginner-friendly stretch suitable for kayaking, described as flat/placid water. | verified | https://activities.marriott.com/asia/india/goa/activities/goa_kayaking_sal_backwaters_mangroves_magic-XJWBKD |
| `goa-sal-river-sunset-paddle` | Otters can be spotted on the Sal estuary. | corrected | https://goawaterstories.livingwatersmuseum.org/stories/the-sal-river |
| `goa-sal-river-sunset-paddle` | Kayaking season November to May. | verified | https://www.tripadvisor.com/AttractionProductReview-g3397702-d11481580-Goa_Kayaking_Sal_Backwaters_Mangroves_Magic.html |
| `goa-chorla-ghat-forest-camp` | Chorla Ghat sits at an elevation of approximately 800 m. | verified | https://en.wikipedia.org/wiki/Chorla_Ghat |
| `goa-chorla-ghat-forest-camp` | The camp is on the fringe of the Mhadei Wildlife Sanctuary near the Goa-Karnataka border, and the Vazra Sakla falls are nearby in the Chorla Ghat region. | verified | https://en.wikipedia.org/wiki/Mhadei_Wildlife_Sanctuary |
| `goa-chorla-ghat-forest-camp` | Dawn birdwatching with the 'Malabar hornbill'. | corrected | https://en.wikipedia.org/wiki/Mhadei_Wildlife_Sanctuary |
| `goa-chorla-ghat-forest-camp` | Best camping season November to February, after the monsoon. | verified | https://www.tripadvisor.com/Attraction_Review-g297648-d15710971-Reviews-Chorla_Ghat-Maharashtra.html |

### Leh Ladakh (13 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `leh-ladakh-sham-valley-homestay-trek-3d` | Phobe La pass is around 3,650 m (original longDescription bundled both passes at ~3,650 m) | corrected | https://pantheraexpedition.com/sham-valley-trek |
| `leh-ladakh-sham-valley-homestay-trek-3d` | Likir gompa has a 23 m gilded Maitreya Buddha statue | verified | https://www.alamy.com/stock-photo/buddha-india-ladakh-likir-statue.html (and chalbanjare.com) |
| `leh-ladakh-sham-valley-homestay-trek-3d` | Hemis Shukpachan is a juniper village; Tsermangchan La is the day-2 pass; top altitude under 4,000 m | verified | https://www.himalayanecotourism.com/hemis-shukpachan/ |
| `leh-ladakh-sham-valley-homestay-trek-3d` | Best season is June-September (months 6,7,8,9) and no permit is required | verified | https://brozaadventures.com/sham-valley-trek |
| `leh-ladakh-sham-valley-homestay-trek-3d` | Likir Monastery is about 60 km west of Leh | corrected | https://pantheraexpedition.com/sham-valley-trek |
| `leh-ladakh-indus-phey-nimu-family-rafting` | The Phey-to-Nimu Indus stretch is Grade II-III | corrected | https://www.eladakhtourism.com/river-rafting.html |
| `leh-ladakh-indus-phey-nimu-family-rafting` | Guests are issued dry-suits for the run | corrected | https://www.eladakhtourism.com/river-rafting.html |
| `leh-ladakh-indus-phey-nimu-family-rafting` | Phey put-in is about 12 km west of Leh and Nimu confluence (Sangam) is the take-out, ~25 km float | verified | http://www.ladakhdekho.com/river-rafting-ladakh.html |
| `leh-ladakh-indus-phey-nimu-family-rafting` | Best rafting season is June-August (months 6,7,8) and no permit needed | verified | https://www.eladakhtourism.com/river-rafting.html |
| `leh-ladakh-tso-moriri-changthang-camp-3d` | Tso Moriri sits at 4,595 m | corrected | https://en.wikipedia.org/wiki/Tso_Moriri |
| `leh-ladakh-tso-moriri-changthang-camp-3d` | Tso Moriri is the world's highest Ramsar lake/wetland | corrected | https://en.wikipedia.org/wiki/Tso_Moriri |
| `leh-ladakh-tso-moriri-changthang-camp-3d` | An Inner Line Permit is mandatory for the restricted Changthang/Tso Moriri zone | verified | https://www.lehladakhtaxis.com/practical-info/inner-line-permit-for-ladakh |
| `leh-ladakh-tso-moriri-changthang-camp-3d` | Korzok gompa is about 400 years old and is a protected Wetland Conservation Reserve hosting black-necked cranes and bar-headed geese | verified | https://wildlife.jk.gov.in/wild/pdf/pub/MANAGEMENT_PLANNING_for_tsomoriri.pdf |

### Kasol (15 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `kasol-tosh-kutla-meadow-trek-2d` | Tosh village sits at about 2,400 m | verified | https://www.facebook.com/groups/3257047084341234/posts/6048386021873979/ |
| `kasol-tosh-kutla-meadow-trek-2d` | Kutla meadow is at 2,750 m | verified | http://www.thehillgypsy.com/hikeup/the-kutla-trek/ |
| `kasol-tosh-kutla-meadow-trek-2d` | Tosh-to-Kutla climb is a 'steep 2 km climb' | corrected | http www.thehillgypsy.com/hikeup/the-kutla-trek/ (says Kutla is a 3 km trek from Tosh) |
| `kasol-tosh-kutla-meadow-trek-2d` | Best season is April–June and September–October | verified | http://www.thehillgypsy.com/hikeup/the-kutla-trek/ (season March to mid-July, September to November) |
| `kasol-tosh-kutla-meadow-trek-2d` | No statutory permit required (permits: []) | verified | https://travellingslacker.com/parvati-valley-diy-guide-all-you-need-to-know-about-kasol/ |
| `kasol-grahan-meadow-waterfall-camp-2d` | Grahan village is at 2,346 m | verified | https://tavernatravels.com/grahan-village-the-most-beautiful-village-in-india/ |
| `kasol-grahan-meadow-waterfall-camp-2d` | 9 km forest trail from Kasol, about 4–5 hours | verified | https://logout.world/tours/grahan-trek/ (≈9 km one way, 4–5 hours) |
| `kasol-grahan-meadow-waterfall-camp-2d` | Best from April to June and September to November | verified | https://www.reddit.com/r/Desire4travels/comments/1krufbz/best_time_to_visit_parvati_valley_a_seasonal/ |
| `kasol-grahan-meadow-waterfall-camp-2d` | No statutory permit required (permits: []) | verified | https://travellingslacker.com/parvati-valley-diy-guide-all-you-need-to-know-about-kasol/ |
| `kasol-malana-chanderkhani-pass-trek-4d` | Chanderkhani Pass is at 3,660 m | verified | https://en.wikipedia.org/wiki/Chanderkhani |
| `kasol-malana-chanderkhani-pass-trek-4d` | Malana village is at 2,652 m | verified | https://en.wikipedia.org/wiki/Malana,_Himachal_Pradesh |
| `kasol-malana-chanderkhani-pass-trek-4d` | A 'challenging' / 'moderate-plus' trek | corrected | https://indiahikes.com/chandrakhani-pass-trek (rates the trek Easy–Moderate) |
| `kasol-malana-chanderkhani-pass-trek-4d` | Best attempted May to September | verified | https://indiahikes.com/chandrakhani-pass-trek (best time May–September, can extend to October) |
| `kasol-malana-chanderkhani-pass-trek-4d` | Route runs Naggar/Rumsu over the pass to Malana, exiting toward Kasol; Malana is self-governed | verified | https://en.wikipedia.org/wiki/Chanderkhani |
| `kasol-malana-chanderkhani-pass-trek-4d` | No statutory permit required (permits: []) | verified | https://travellingslacker.com/parvati-valley-diy-guide-all-you-need-to-know-about-kasol/ |

### Spiti (15 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `spiti-kanamo-peak-summit-expedition` | Kanamo Peak summit altitude is 5,964 m / 19,553 ft | corrected | https://indiahikes.com/kanamo-peak-trek |
| `spiti-kanamo-peak-summit-expedition` | Kanamo is higher than any summit in the Alps | verified | https://en.wikipedia.org/wiki/Mont_Blanc |
| `spiti-kanamo-peak-summit-expedition` | Kibber village base is ~4,200 m and the climb is non-technical (no ropes/ice axe) | verified | https://chalo-travels.com/travel/12280/i-just-cant-let-it-go/ |
| `spiti-kanamo-peak-summit-expedition` | No permit required (permits: []) | corrected | https://en.wikipedia.org/wiki/Spiti_Valley |
| `spiti-kanamo-peak-summit-expedition` | Best season Jun-Sep (seasonMonths 6,7,8,9) | verified | https://indiahikes.com/kanamo-peak-trek |
| `spiti-dhankar-village-camp-and-lake-hike` | Sacred Dhankar Lake sits at 4,140 m | verified | https://indiahikes.com/documented-trek/dhankar-lake-trek |
| `spiti-dhankar-village-camp-and-lake-hike` | Dhankar Gompa is ~1,200 years old | corrected | https://en.wikipedia.org/wiki/Dhankar_Gompa |
| `spiti-dhankar-village-camp-and-lake-hike` | Steep hike of about 2 km from Dhankar village to the lake | verified | https://indiahikes.com/documented-trek/dhankar-lake-trek |
| `spiti-dhankar-village-camp-and-lake-hike` | Dhankar is the former capital of Spiti at the Spiti-Pin river confluence | verified | https://en.wikipedia.org/wiki/Dhankar_Gompa |
| `spiti-dhankar-village-camp-and-lake-hike` | No permit required (permits: []) | corrected | https://en.wikipedia.org/wiki/Spiti_Valley |
| `spiti-highest-villages-fossil-jeep-safari` | Hikkim hosts the world's highest post office at 4,440 m | corrected | https://en.wikipedia.org/wiki/Hikkim |
| `spiti-highest-villages-fossil-jeep-safari` | Langza sits at 4,400 m with a giant Buddha and marine-fossil fields | verified | https://travelcoffee.in/places-to-visit/langza-village |
| `spiti-highest-villages-fossil-jeep-safari` | Komic is at ~4,587 m and Tangyud is the highest motorable monastery | corrected | https://en.wikipedia.org/wiki/Tangyud_Monastery |
| `spiti-highest-villages-fossil-jeep-safari` | Spiti's Tethys-Ocean past left ammonite fossils in these fields | verified | https://www.facebook.com/groups/1528556590661443/posts/2279008675616227/ |
| `spiti-highest-villages-fossil-jeep-safari` | No permit required (permits: []) | corrected | https://en.wikipedia.org/wiki/Spiti_Valley |

### Andaman (13 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `andaman-saddle-peak-summit-diglipur` | Saddle Peak is 732 m and the highest point in the Andaman & Nicobar Islands. | verified | https://www.tripadvisor.com/Attraction_Review-g3382376-d12384141-Reviews-Saddle_Peak_National_Park-Diglipur_North_Andaman_Island_Andaman_and_Nicobar_Isl.html |
| `andaman-saddle-peak-summit-diglipur` | Highest point in the 'Bay of Bengal archipelago'. | corrected | https://www.tripadvisor.com/Attraction_Review-g3382376-d12384141-Reviews-Saddle_Peak_National_Park-Diglipur_North_Andaman_Island_Andaman_and_Nicobar_Isl.html |
| `andaman-saddle-peak-summit-diglipur` | Trail is roughly 16 km round trip (about 8 km each way), full-day trek (~8 hours). | verified | http://www.trodly.com/activity-656-saddle-peak-national-park-hike |
| `andaman-saddle-peak-summit-diglipur` | A Restricted Area Permit (RAP) is required for foreign nationals. | corrected | https://tourism.andamannicobar.gov.in/userpages/admin/whatsnewfile/2026030570Restricted%20Area%20Permit.pdf |
| `andaman-saddle-peak-summit-diglipur` | Trek starts near Kalipur / Lamiya Bay in Diglipur. | verified | https://indiahikes.com/documented-trek/saddle-peak-trek |
| `andaman-neil-island-aquarium-bus-stop-dive` | Aquarium is a shallow 8-12 m beginner-friendly site near Neil Island. | verified | https://www.scubalov.in/neil-dive-sites/neil-island-aquarium/ |
| `andaman-neil-island-aquarium-bus-stop-dive` | Bus Stop is a calm, shallow 8-12 m site with smooth conditions suited to all levels off the western end. | corrected | https://www.scubalov.in/neil-dive-sites/neil-island-bus-stop/ |
| `andaman-neil-island-aquarium-bus-stop-dive` | Diving season is October to mid-May with best visibility. | verified | https://www.turquoisedream.in/blog/neil-island-scuba-diving |
| `andaman-neil-island-aquarium-bus-stop-dive` | Two guided fun dives plus gear priced at 5500-6800 per person. | verified | https://www.quora.com/What-would-be-the-price-of-scuba-diving-in-Andaman |
| `andaman-rangat-mangrove-creek-kayak-yerrata` | Yerrata Jetty / Yerrata creek is near Mayabunder in Middle Andaman. | refuted | https://www.experienceandamans.com/andaman-tourism/rangat/places/yerrata-creek |
| `andaman-rangat-mangrove-creek-kayak-yerrata` | Yerrata has dense mangrove creeks with kingfishers, herons, mud crabs and water monitors. | verified | https://www.experienceandamans.com/andaman-tourism/rangat/places/yerrata-creek |
| `andaman-rangat-mangrove-creek-kayak-yerrata` | Daytime mangrove kayak, ~3 hours, priced 2400-3200 per person. | verified | https://www.andamanislands.com/tour-category/kayaking-in-andaman-islands |
| `andaman-rangat-mangrove-creek-kayak-yerrata` | Kayaking season is October to May (dry season). | verified | https://andamanislandtravel.wixsite.com/discoverandamanislan/post/best-months-for-scuba-diving-in-andaman-based-on-weather |

### Lonavala (14 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `lonavala-lohagad-visapur-twin-fort-trek` | Lohagad fort altitude is 1,033 m | verified | https://en.wikipedia.org/wiki/Lohagad |
| `lonavala-lohagad-visapur-twin-fort-trek` | Visapur fort altitude is 1,084 m | verified | https://en.wikipedia.org/wiki/Visapur_Fort |
| `lonavala-lohagad-visapur-twin-fort-trek` | Vinchu Kata is a fortified 'scorpion's tail' spur of Lohagad | verified | https://www.treksandtrails.org/tours/lohagad-fort-one-day-trek-2025 |
| `lonavala-lohagad-visapur-twin-fort-trek` | Route starts from Malavli station and covers roughly 12 km across both forts | verified | https://www.facebook.com/groups/TeamSanchari/posts/1982493331808461/ |
| `lonavala-lohagad-visapur-twin-fort-trek` | Best in monsoon with waterfall stairs on the Visapur ascent (seasonMonths Jun-Feb) | verified | https://www.bikatadventures.com/home/blog/diy-guide-to-visapur-fort-trek |
| `lonavala-lohagad-visapur-twin-fort-trek` | No special trekking permit required (permits: []); only a minor ASI entry ticket applies at Lohagad | corrected | https://asi.paygov.org.in/asi-webapp/ |
| `lonavala-pawna-lake-sunrise-kayaking` | Tung (Kathingad) and Tikona forts are visible on the Pawna Lake skyline | verified | https://en.wikipedia.org/wiki/Tung_Fort |
| `lonavala-pawna-lake-sunrise-kayaking` | Kayaking is offered on Pawna Lake near Lonavala | verified | https://www.cosmicstays.com/explore/pawna/things-to-do |
| `lonavala-pawna-lake-sunrise-kayaking` | Life-jackets are 'Coast-guard-approved' | corrected | https://www.cosmicstays.com/explore/pawna/things-to-do |
| `lonavala-pawna-lake-sunrise-kayaking` | Best season is the cool October-to-May window (seasonMonths Oct-May) | verified | https://pawnalakescamping.com/kayaking-boating-pawna-lake-2025.htm |
| `lonavala-korigad-fort-beginner-sunrise-trek` | Korigad fort is about 923 m above sea level | verified | https://en.wikipedia.org/wiki/Korigad |
| `lonavala-korigad-fort-beginner-sunrise-trek` | Summit has a near-complete circular rampart, two water cisterns, the Korai Devi temple and old cannons | verified | https://en.wikipedia.org/wiki/Korigad |
| `lonavala-korigad-fort-beginner-sunrise-trek` | Trailhead is Peth Shahpur village near Aamby Valley road, about 25 km from Lonavala town | verified | https://en.wikipedia.org/wiki/Korigad |
| `lonavala-korigad-fort-beginner-sunrise-trek` | Guided Korigad day-trek pricing (p12 Rs 1100) is operator-plausible | verified | https://www.bhatakna.com/tours/korigad-fort-trek-2025 |

### Auli (14 claims)

| listingSlug | claim | verdict | source |
| --- | --- | --- | --- |
| `auli-skiing-7-day-learn-to-ski-course` | Auli's slopes are 'cedar-lined'. | corrected | https://www.facebook.com/UttarakhandTourismOfficialPage/posts/ |
| `auli-skiing-7-day-learn-to-ski-course` | 3 km groomed slope with ~500 m vertical drop. | verified | https://junegiriyatra.com/blog/auli-skiing-guide/ |
| `auli-skiing-7-day-learn-to-ski-course` | Slopes sit between ~2,500 m and 3,050 m on a north-facing aspect. | verified | https://www.auliskiing.in/promotion-ski-fun-course.html |
| `auli-skiing-7-day-learn-to-ski-course` | Season window January–March for a learn-to-ski course. | verified | https://devbhumidarshan.com/auli-skiing-2025-complete-guide.html |
| `auli-skiing-7-day-learn-to-ski-course` | 7-day beginner ski course pricing (₹16,500–₹21,000 per person tiers). | verified | https://www.auliskiing.in/promotion-ski-fun-course.html (₹17,999) |
| `auli-skiing-7-day-learn-to-ski-course` | Course referenced a 'GMVN/IISM' training format; no special permit required for skiing. | corrected | https://www.abvimas.org/course/basic-skiing-course/ |
| `auli-trekking-kuari-pass-winter-6d` | Kuari Pass altitude is about 3,815 m. | verified | https://indiahikes.com/kuari-pass (12,516 ft) |
| `auli-trekking-kuari-pass-winter-6d` | Trek is on the historic 'Lord Curzon's Trail', a 6-day route. | verified | https://www.bikatadventures.com/home/blog/why-kuari-pass-is-called-lord-curzon-trail |
| `auli-trekking-kuari-pass-winter-6d` | Summit views include Nanda Devi, Dronagiri, Chaukhamba, Hathi-Ghoda and Kamet; route passes Gorson Bugyal, Tali and Khullara. | verified | https://www.facebook.com/indiahikes/posts/1046559670852121/ |
| `auli-trekking-kuari-pass-winter-6d` | Frozen Tali alpine lake near camp. | verified | https://trekthehimalayas.com/kuari-pass-trek-guide |
| `auli-trekking-kuari-pass-winter-6d` | permits = [] (no permit required). | refuted | https://www.kuaripass.org/about |
| `auli-camping-snow-meadow-night-plus-trek` | Snow camp 'at around 2,900 m above Auli'. | corrected | https://www.tripadvisor.com/.../Gorson_Bugyal-Auli (Auli 2,500–3,050 m) |
| `auli-camping-snow-meadow-night-plus-trek` | Gorson Bugyal meadows with views of Nanda Devi, Kamet and Dunagiri. | verified | https://en.wikipedia.org/wiki/Gorson_Bugyal |
| `auli-camping-snow-meadow-night-plus-trek` | permits = [] for snow camping on the Gorson/Auli meadows. | corrected | https://www.kuaripass.org/about |

## Existing 32 catalog — headline-claim audit

_Audited headline claims for the existing catalog. The supplied `existing-audit.json` contained 12 audited headline claims (the load-bearing factual headline per entry); all 12 are reproduced below verbatim. (No further entries were present in the audit input.)_

| id | claim | verdict | corrected fact | source |
| --- | --- | --- | --- | --- |
| 1 | Rishikesh bungee at Jumpin Heights is 83 m (India's highest fixed-platform bungee), over the Hyul river gorge | verified | 83 m and 'India's highest fixed-platform bungee' are both verified for Jumpin Heights (Mohan Chatti village, near Rishikesh, Uttarakhand). Note: a competing operator (Himalayan Bungy) now advertises a 113 m jump, but the long-standing 'India's highest FIXED-PLATFORM' record belongs to Jumpin Heights at 83 m, so the qualifier holds. The 'Hyul river gorge' detail could not be confirmed verbatim on the operator's current page (they only reference 'the river' generically and a 2 ft drop zone); it is consistent with the operator's historical branding (the seasonal Hyul/Heul tributary) but is the one unverified sub-detail. | https://www.klook.com/en-US/activity/12092-bungee-jumping-rishikesh/ |
| 2 | Markha Valley trek crosses Kongmaru La at 5,260 m, in Hemis National Park, requires Inner Line Permit | corrected | Kongmaru La at 5,260 m and the trek being inside Hemis National Park are both verified. The permit is WRONG: the Markha Valley trek does not require an Inner Line Permit (ILP). Because the trail lies within Hemis National Park, it requires a Wildlife Department / Hemis NP entry permit (Wildlife protection / Protected Area entry fee, obtained from the Wildlife Office in Leh). ILP applies to border areas such as Nubra, Pangong and Tso Moriri, not to the standard Markha route. Replace 'requires Inner Line Permit' with 'requires a Hemis National Park / Wildlife Department entry permit'. | https://endeavorladakh.com/hemis-national-park-ladakh-ultimate-guide-for-your-bike-trip/ |
| 3 | Zanskar river rafting Chilling to Nimu is roughly 26 km, Grade III-IV, runs Jul-Aug, ends at Indus confluence | corrected | Distance is understated: the Chilling-to-Nimu/Nemo run is consistently cited as ~28 km, not ~26 km. Grade III-IV is acceptable (most operators cite Grade III with III-IV/IV+ sections near the end). Ending at the Indus-Zanskar confluence (Sangam) at Nimu/Nemo is correct. Season: best/peak flows are mid-to-late July with trips running roughly June-September, so 'Jul-Aug' is within the valid window. Change 'roughly 26 km' to 'roughly 28 km'. | https://www.himalayanwonders.com/blog/rafting-the-zanskar-from-chilling-to-nemo.html |
| 4 | Nubra Valley safari crosses Khardung La at 5,359 m; Hunder Bactrian (double-humped) camels; Inner Line Permit | verified | All sub-claims verified: Khardung La sits at 5,359 m; Hunder sand dunes offer double-humped Bactrian camel rides; and an Inner Line Permit is required for Nubra Valley. | https://www.exoticamp.com/blogs/khardung-la-pass-travel-tips |
| 5 | Pangong Tso is at roughly 4,350 m altitude and requires Inner Line Permit | verified | Verified. Pangong Tso sits at ~4,350 m (14,270 ft) and Indian nationals require an Inner Line Permit due to its location in a Sino-Indian border zone. | https://www.tripsavvy.com/how-to-visit-pangong-lake-the-complete-guide-4172006 |
| 6 | Beas Kund trek glacial source of the Beas near Solang, around 3,650 m, season May-Oct | verified | Verified. Beas Kund is the glacial source of the River Beas, the trek starts from Solang Nala/Palchan, and the kund/lake is cited at ~3,650-3,700 m (note: Indiahikes lists the trek's HIGHEST point at 12,772 ft / ~3,890 m, but the kund itself is ~3,650 m, matching the claim). Best season is May to October. | https://www.facebook.com/indiahikes/posts/the-beas-kund-trek-is-one-of-the-most-rewarding-yet-a-short-trek-in-the-himalaya/1127048679469886/ |
| 7 | Auli skiing slopes around 2,800 m, GMVN chairlift/cable car, season Jan-Mar, Nanda Devi views | verified | Verified. Auli sits at ~2,800 m, offers skiing with a GMVN-operated cable car/ropeway and chairlift, peak ski season is January-March (peak conditions reported late Jan 2026 after heavy snowfall), and it commands views of Nanda Devi. | https://www.instagram.com/p/DRWd1WvE_YO/?hl=en |
| 8 | Bir-Billing is a top paragliding site, Billing launch ~2,400 m, seasons Mar-May and Sep-Nov | verified | Verified. Bir-Billing is one of the top (often called the world's second-highest) paragliding sites; the Billing take-off is at ~2,400 m (cited as 2,428 m by Cross Country Magazine); and the prime seasons are March-May/June and September-November. | https://xcmag.com/travel-guide/guide-to-bir-india/ |
| 9 | Sar Pass trek from Kasol crosses ~4,220 m, season ~May-Jun, glissade/snow-slide descent to Biskeri Thach | verified | Verified. The Sar Pass trek starts from Kasol/Grahan, tops out at ~4,220 m (13,850 ft), and features a thrilling glissade/snow-slide descent down to Biskeri Thach. Best season is roughly April-July with May-June being peak, so '~May-Jun' is accurate. | https://www.instagram.com/p/DXG7RhAEgE-/ |
| 10 | Goa Grande Island dive sites Suzy's Wreck and Davy Jones' Locker, depths ~12-18 m, season Oct-May | verified | Verified. Grande (Grand) Island is Goa's main dive destination and hosts the two named wrecks, Suzy's Wreck and Davy Jones' Locker. Depths vary by source (Suzy's Wreck cited from ~6-12 m up to ~18-22 m); the claim's '~12-18 m' sits within the cited range and is a reasonable representation. Diving season is October-May (post-monsoon). | https://www.padi.com/dive-site/india/grande-island/ |
| 11 | Havelock (Swaraj Dweep) scuba season Oct-May; Radhanagar Beach is on Havelock | verified | Verified by PADI. The best scuba season for Swaraj Dweep (formerly Havelock Island) is October to May, and the award-winning Radhanagar Beach (Beach No. 7) is located on Havelock Island. | https://www.padi.com/diving-in/india/havelock-island-swaraj-dweep/ |
| 12 | Chandratal lake ~4,300 m on the Spiti-Lahaul boundary, road open Jun-Sep only | verified | Verified. Chandratal (Moon Lake) sits at ~4,300 m in the Spiti/Lahaul region of Himachal Pradesh, and access roads are open only seasonally (roughly mid-June to September/early October; heavy winter snowfall closes them). | https://www.wanderinman.com/blog/chandratal-lake-with-complete-guide/ |
