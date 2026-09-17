(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=class{static generatePoints(e,t,n,r,i){let a=[],o=i.length-1,s=(r-n)/Math.max(1,o);for(let r=0;r<=o;r++){let c=Math.round(n+r*s),l=i[r]??.2,u=Math.round(e+t*l);a.push({id:`pt_${Math.random().toString(36).substring(2,9)}`,x:u,y:c,type:r%4==0?`manual`:`transition`,isManual:r%4==0,createdAt:Date.now()-(o-r)*1e3})}return a}static createDefaultDiagramData(){return this.getHoyaDiagramData()}static getHoyaDiagramData(){return{imageSrc:`./hoya-del-castillo.png`,imageWidth:2339,imageHeight:1654,calibration:{dataXMin:315,dataXMax:1946,dataYMin:511,dataYMax:1311,depthTopValue:0,depthBottomValue:450,unit:`cm`,isCalibrated:!0,depthInterval:10,depthGridEnabled:!0},columns:[{id:`taxa_0`,name:`Charcoal`,color:`#38bdf8`,startX:319,endX:497,maxPercent:100,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_0_0`,x:321,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_0_2`,x:330,y:513,type:`transition`,isManual:!1,createdAt:1700000000002},{id:`pt_0_302`,x:332,y:813,type:`transition`,isManual:!1,createdAt:1700000000302},{id:`pt_0_307`,x:497,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_0_309`,x:338,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_0_323`,x:350,y:834,type:`transition`,isManual:!1,createdAt:1700000000323},{id:`pt_0_368`,x:433,y:879,type:`transition`,isManual:!1,createdAt:1700000000368},{id:`pt_0_408`,x:408,y:919,type:`transition`,isManual:!1,createdAt:1700000000408},{id:`pt_0_433`,x:369,y:944,type:`transition`,isManual:!1,createdAt:1700000000433},{id:`pt_0_495`,x:329,y:1006,type:`transition`,isManual:!1,createdAt:1700000000495},{id:`pt_0_516`,x:332,y:1027,type:`transition`,isManual:!1,createdAt:1700000000516},{id:`pt_0_537`,x:358,y:1048,type:`transition`,isManual:!1,createdAt:1700000000537},{id:`pt_0_560`,x:333,y:1071,type:`transition`,isManual:!1,createdAt:1700000000560},{id:`pt_0_581`,x:343,y:1092,type:`transition`,isManual:!1,createdAt:1700000000581},{id:`pt_0_617`,x:334,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_0_619`,x:497,y:1130,type:`transition`,isManual:!1,createdAt:1700000000619},{id:`pt_0_620`,x:333,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_0_711`,x:337,y:1222,type:`transition`,isManual:!1,createdAt:1700000000711},{id:`pt_0_747`,x:325,y:1258,type:`transition`,isManual:!1,createdAt:1700000000747},{id:`pt_0_794`,x:325,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_0_796`,x:497,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_0_799`,x:321,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_1`,name:`Pinus`,color:`#34d399`,startX:497,endX:728,maxPercent:100,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_1_0`,x:499,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_1_23`,x:655,y:534,type:`transition`,isManual:!1,createdAt:1700000000023},{id:`pt_1_66`,x:640,y:577,type:`transition`,isManual:!1,createdAt:1700000000066},{id:`pt_1_108`,x:687,y:619,type:`transition`,isManual:!1,createdAt:1700000000108},{id:`pt_1_184`,x:701,y:695,type:`transition`,isManual:!1,createdAt:1700000000184},{id:`pt_1_302`,x:648,y:813,type:`transition`,isManual:!1,createdAt:1700000000302},{id:`pt_1_307`,x:728,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_1_309`,x:655,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_1_325`,x:666,y:836,type:`transition`,isManual:!1,createdAt:1700000000325},{id:`pt_1_346`,x:606,y:857,type:`transition`,isManual:!1,createdAt:1700000000346},{id:`pt_1_407`,x:599,y:918,type:`transition`,isManual:!1,createdAt:1700000000407},{id:`pt_1_473`,x:602,y:984,type:`transition`,isManual:!1,createdAt:1700000000473},{id:`pt_1_495`,x:660,y:1006,type:`transition`,isManual:!1,createdAt:1700000000495},{id:`pt_1_517`,x:640,y:1028,type:`transition`,isManual:!1,createdAt:1700000000517},{id:`pt_1_537`,x:667,y:1048,type:`transition`,isManual:!1,createdAt:1700000000537},{id:`pt_1_560`,x:647,y:1071,type:`transition`,isManual:!1,createdAt:1700000000560},{id:`pt_1_582`,x:666,y:1093,type:`transition`,isManual:!1,createdAt:1700000000582},{id:`pt_1_617`,x:644,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_1_619`,x:728,y:1130,type:`transition`,isManual:!1,createdAt:1700000000619},{id:`pt_1_620`,x:640,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_1_709`,x:546,y:1220,type:`transition`,isManual:!1,createdAt:1700000000709},{id:`pt_1_794`,x:563,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_1_796`,x:728,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_1_799`,x:499,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_2`,name:`Juniperus`,color:`#fbbf24`,startX:728,endX:864,maxPercent:100,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_2_0`,x:730,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_2_246`,x:730,y:757,type:`transition`,isManual:!1,createdAt:1700000000246},{id:`pt_2_306`,x:742,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_2_307`,x:864,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_2_309`,x:741,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_2_406`,x:733,y:917,type:`transition`,isManual:!1,createdAt:1700000000406},{id:`pt_2_602`,x:742,y:1113,type:`transition`,isManual:!1,createdAt:1700000000602},{id:`pt_2_617`,x:755,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_2_618`,x:864,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_2_620`,x:757,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_2_665`,x:774,y:1176,type:`transition`,isManual:!1,createdAt:1700000000665},{id:`pt_2_687`,x:847,y:1198,type:`transition`,isManual:!1,createdAt:1700000000687},{id:`pt_2_709`,x:821,y:1220,type:`transition`,isManual:!1,createdAt:1700000000709},{id:`pt_2_754`,x:840,y:1265,type:`transition`,isManual:!1,createdAt:1700000000754},{id:`pt_2_777`,x:777,y:1288,type:`transition`,isManual:!1,createdAt:1700000000777},{id:`pt_2_794`,x:786,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_2_796`,x:864,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_2_799`,x:730,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_3`,name:`Quercus ilex-type`,color:`#a78bfa`,startX:864,endX:939,maxPercent:50,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_3_0`,x:866,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_3_2`,x:891,y:513,type:`transition`,isManual:!1,createdAt:1700000000002},{id:`pt_3_24`,x:879,y:535,type:`transition`,isManual:!1,createdAt:1700000000024},{id:`pt_3_67`,x:888,y:578,type:`transition`,isManual:!1,createdAt:1700000000067},{id:`pt_3_171`,x:870,y:682,type:`transition`,isManual:!1,createdAt:1700000000171},{id:`pt_3_217`,x:870,y:728,type:`transition`,isManual:!1,createdAt:1700000000217},{id:`pt_3_259`,x:888,y:770,type:`transition`,isManual:!1,createdAt:1700000000259},{id:`pt_3_306`,x:885,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_3_307`,x:939,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_3_309`,x:884,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_3_321`,x:881,y:832,type:`transition`,isManual:!1,createdAt:1700000000321},{id:`pt_3_344`,x:909,y:855,type:`transition`,isManual:!1,createdAt:1700000000344},{id:`pt_3_433`,x:914,y:944,type:`transition`,isManual:!1,createdAt:1700000000433},{id:`pt_3_473`,x:903,y:984,type:`transition`,isManual:!1,createdAt:1700000000473},{id:`pt_3_496`,x:886,y:1007,type:`transition`,isManual:!1,createdAt:1700000000496},{id:`pt_3_615`,x:876,y:1126,type:`transition`,isManual:!1,createdAt:1700000000615},{id:`pt_3_619`,x:939,y:1130,type:`transition`,isManual:!1,createdAt:1700000000619},{id:`pt_3_620`,x:877,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_3_666`,x:890,y:1177,type:`transition`,isManual:!1,createdAt:1700000000666},{id:`pt_3_688`,x:872,y:1199,type:`transition`,isManual:!1,createdAt:1700000000688},{id:`pt_3_727`,x:867,y:1238,type:`transition`,isManual:!1,createdAt:1700000000727},{id:`pt_3_794`,x:868,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_3_796`,x:939,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_3_799`,x:866,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_4`,name:`Quercus suber-type`,color:`#f472b6`,startX:939,endX:971,maxPercent:50,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_4_0`,x:941,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_4_255`,x:939,y:766,type:`transition`,isManual:!1,createdAt:1700000000255},{id:`pt_4_306`,x:944,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_4_307`,x:971,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_4_309`,x:944,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_4_322`,x:941,y:833,type:`transition`,isManual:!1,createdAt:1700000000322},{id:`pt_4_343`,x:948,y:854,type:`transition`,isManual:!1,createdAt:1700000000343},{id:`pt_4_365`,x:943,y:876,type:`transition`,isManual:!1,createdAt:1700000000365},{id:`pt_4_464`,x:946,y:975,type:`transition`,isManual:!1,createdAt:1700000000464},{id:`pt_4_617`,x:941,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_4_619`,x:971,y:1130,type:`transition`,isManual:!1,createdAt:1700000000619},{id:`pt_4_620`,x:941,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_4_734`,x:939,y:1245,type:`transition`,isManual:!1,createdAt:1700000000734},{id:`pt_4_794`,x:939,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_4_796`,x:971,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_4_799`,x:941,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_5`,name:`Olea`,color:`#fb7185`,startX:971,endX:1001,maxPercent:50,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_5_0`,x:973,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_5_70`,x:975,y:581,type:`transition`,isManual:!1,createdAt:1700000000070},{id:`pt_5_91`,x:971,y:602,type:`transition`,isManual:!1,createdAt:1700000000091},{id:`pt_5_299`,x:971,y:810,type:`transition`,isManual:!1,createdAt:1700000000299},{id:`pt_5_306`,x:973,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_5_307`,x:1001,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_5_309`,x:973,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_5_617`,x:973,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_5_618`,x:1001,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_5_620`,x:973,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_5_794`,x:973,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_5_795`,x:1001,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_5_799`,x:973,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_6`,name:`Betula`,color:`#2dd4bf`,startX:1001,endX:1033,maxPercent:50,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_6_0`,x:1003,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_6_237`,x:1001,y:748,type:`transition`,isManual:!1,createdAt:1700000000237},{id:`pt_6_242`,x:1004,y:753,type:`transition`,isManual:!1,createdAt:1700000000242},{id:`pt_6_272`,x:1005,y:783,type:`transition`,isManual:!1,createdAt:1700000000272},{id:`pt_6_306`,x:1001,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_6_307`,x:1033,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_6_309`,x:1003,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_6_313`,x:1001,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_6_339`,x:1005,y:850,type:`transition`,isManual:!1,createdAt:1700000000339},{id:`pt_6_402`,x:1004,y:913,type:`transition`,isManual:!1,createdAt:1700000000402},{id:`pt_6_410`,x:1001,y:921,type:`transition`,isManual:!1,createdAt:1700000000410},{id:`pt_6_617`,x:1001,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_6_618`,x:1033,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_6_620`,x:1003,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_6_623`,x:1001,y:1134,type:`transition`,isManual:!1,createdAt:1700000000623},{id:`pt_6_731`,x:1001,y:1242,type:`transition`,isManual:!1,createdAt:1700000000731},{id:`pt_6_747`,x:1005,y:1258,type:`transition`,isManual:!1,createdAt:1700000000747},{id:`pt_6_792`,x:1006,y:1303,type:`transition`,isManual:!1,createdAt:1700000000792},{id:`pt_6_795`,x:1033,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_6_799`,x:1003,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_7`,name:`Corylus`,color:`#818cf8`,startX:1033,endX:1065,maxPercent:50,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_7_0`,x:1035,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_7_2`,x:1039,y:513,type:`transition`,isManual:!1,createdAt:1700000000002},{id:`pt_7_24`,x:1035,y:535,type:`transition`,isManual:!1,createdAt:1700000000024},{id:`pt_7_64`,x:1044,y:575,type:`transition`,isManual:!1,createdAt:1700000000064},{id:`pt_7_106`,x:1035,y:617,type:`transition`,isManual:!1,createdAt:1700000000106},{id:`pt_7_223`,x:1037,y:734,type:`transition`,isManual:!1,createdAt:1700000000223},{id:`pt_7_255`,x:1042,y:766,type:`transition`,isManual:!1,createdAt:1700000000255},{id:`pt_7_306`,x:1037,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_7_307`,x:1065,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_7_309`,x:1038,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_7_390`,x:1042,y:901,type:`transition`,isManual:!1,createdAt:1700000000390},{id:`pt_7_498`,x:1039,y:1009,type:`transition`,isManual:!1,createdAt:1700000000498},{id:`pt_7_515`,x:1044,y:1026,type:`transition`,isManual:!1,createdAt:1700000000515},{id:`pt_7_606`,x:1039,y:1117,type:`transition`,isManual:!1,createdAt:1700000000606},{id:`pt_7_617`,x:1041,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_7_619`,x:1065,y:1130,type:`transition`,isManual:!1,createdAt:1700000000619},{id:`pt_7_620`,x:1042,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_7_668`,x:1033,y:1179,type:`transition`,isManual:!1,createdAt:1700000000668},{id:`pt_7_748`,x:1037,y:1259,type:`transition`,isManual:!1,createdAt:1700000000748},{id:`pt_7_794`,x:1033,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_7_796`,x:1065,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_7_799`,x:1035,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_8`,name:`Carpinus-type`,color:`#f97316`,startX:1065,endX:1097,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_8_0`,x:1067,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_8_104`,x:1065,y:615,type:`transition`,isManual:!1,createdAt:1700000000104},{id:`pt_8_117`,x:1068,y:628,type:`transition`,isManual:!1,createdAt:1700000000117},{id:`pt_8_176`,x:1067,y:687,type:`transition`,isManual:!1,createdAt:1700000000176},{id:`pt_8_236`,x:1071,y:747,type:`transition`,isManual:!1,createdAt:1700000000236},{id:`pt_8_306`,x:1069,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_8_307`,x:1097,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_8_309`,x:1070,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_8_371`,x:1071,y:882,type:`transition`,isManual:!1,createdAt:1700000000371},{id:`pt_8_427`,x:1067,y:938,type:`transition`,isManual:!1,createdAt:1700000000427},{id:`pt_8_480`,x:1069,y:991,type:`transition`,isManual:!1,createdAt:1700000000480},{id:`pt_8_499`,x:1065,y:1010,type:`transition`,isManual:!1,createdAt:1700000000499},{id:`pt_8_601`,x:1065,y:1112,type:`transition`,isManual:!1,createdAt:1700000000601},{id:`pt_8_616`,x:1069,y:1127,type:`transition`,isManual:!1,createdAt:1700000000616},{id:`pt_8_618`,x:1097,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_8_620`,x:1070,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_8_671`,x:1069,y:1182,type:`transition`,isManual:!1,createdAt:1700000000671},{id:`pt_8_689`,x:1065,y:1200,type:`transition`,isManual:!1,createdAt:1700000000689},{id:`pt_8_757`,x:1065,y:1268,type:`transition`,isManual:!1,createdAt:1700000000757},{id:`pt_8_758`,x:1068,y:1269,type:`transition`,isManual:!1,createdAt:1700000000758},{id:`pt_8_794`,x:1069,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_8_796`,x:1097,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_8_799`,x:1067,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_9`,name:`Ericaceae`,color:`#4ade80`,startX:1097,endX:1129,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_9_0`,x:1099,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_9_306`,x:1097,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_9_307`,x:1129,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_9_309`,x:1099,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_9_313`,x:1097,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_9_340`,x:1101,y:851,type:`transition`,isManual:!1,createdAt:1700000000340},{id:`pt_9_368`,x:1097,y:879,type:`transition`,isManual:!1,createdAt:1700000000368},{id:`pt_9_617`,x:1097,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_9_618`,x:1129,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_9_620`,x:1099,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_9_623`,x:1097,y:1134,type:`transition`,isManual:!1,createdAt:1700000000623},{id:`pt_9_794`,x:1097,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_9_795`,x:1129,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_9_799`,x:1099,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_10`,name:`Ephedra distachya-type`,color:`#e879f9`,startX:1129,endX:1161,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_10_0`,x:1131,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_10_221`,x:1133,y:732,type:`transition`,isManual:!1,createdAt:1700000000221},{id:`pt_10_255`,x:1129,y:766,type:`transition`,isManual:!1,createdAt:1700000000255},{id:`pt_10_306`,x:1134,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_10_307`,x:1161,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_10_310`,x:1133,y:821,type:`transition`,isManual:!1,createdAt:1700000000310},{id:`pt_10_368`,x:1129,y:879,type:`transition`,isManual:!1,createdAt:1700000000368},{id:`pt_10_406`,x:1129,y:917,type:`transition`,isManual:!1,createdAt:1700000000406},{id:`pt_10_429`,x:1135,y:940,type:`transition`,isManual:!1,createdAt:1700000000429},{id:`pt_10_534`,x:1131,y:1045,type:`transition`,isManual:!1,createdAt:1700000000534},{id:`pt_10_617`,x:1132,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_10_618`,x:1161,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_10_620`,x:1131,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_10_625`,x:1129,y:1136,type:`transition`,isManual:!1,createdAt:1700000000625},{id:`pt_10_663`,x:1129,y:1174,type:`transition`,isManual:!1,createdAt:1700000000663},{id:`pt_10_687`,x:1135,y:1198,type:`transition`,isManual:!1,createdAt:1700000000687},{id:`pt_10_753`,x:1131,y:1264,type:`transition`,isManual:!1,createdAt:1700000000753},{id:`pt_10_774`,x:1147,y:1285,type:`transition`,isManual:!1,createdAt:1700000000774},{id:`pt_10_794`,x:1145,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_10_796`,x:1161,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_10_799`,x:1131,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_11`,name:`Ephedra fragilis`,color:`#60a5fa`,startX:1161,endX:1193,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_11_0`,x:1163,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_11_70`,x:1165,y:581,type:`transition`,isManual:!1,createdAt:1700000000070},{id:`pt_11_91`,x:1161,y:602,type:`transition`,isManual:!1,createdAt:1700000000091},{id:`pt_11_192`,x:1161,y:703,type:`transition`,isManual:!1,createdAt:1700000000192},{id:`pt_11_213`,x:1165,y:724,type:`transition`,isManual:!1,createdAt:1700000000213},{id:`pt_11_306`,x:1165,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_11_307`,x:1193,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_11_309`,x:1164,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_11_319`,x:1163,y:830,type:`transition`,isManual:!1,createdAt:1700000000319},{id:`pt_11_496`,x:1163,y:1007,type:`transition`,isManual:!1,createdAt:1700000000496},{id:`pt_11_515`,x:1170,y:1026,type:`transition`,isManual:!1,createdAt:1700000000515},{id:`pt_11_555`,x:1163,y:1066,type:`transition`,isManual:!1,createdAt:1700000000555},{id:`pt_11_581`,x:1167,y:1092,type:`transition`,isManual:!1,createdAt:1700000000581},{id:`pt_11_617`,x:1164,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_11_619`,x:1193,y:1130,type:`transition`,isManual:!1,createdAt:1700000000619},{id:`pt_11_620`,x:1163,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_11_625`,x:1161,y:1136,type:`transition`,isManual:!1,createdAt:1700000000625},{id:`pt_11_663`,x:1161,y:1174,type:`transition`,isManual:!1,createdAt:1700000000663},{id:`pt_11_684`,x:1165,y:1195,type:`transition`,isManual:!1,createdAt:1700000000684},{id:`pt_11_791`,x:1164,y:1302,type:`transition`,isManual:!1,createdAt:1700000000791},{id:`pt_11_794`,x:1165,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_11_796`,x:1193,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_11_799`,x:1163,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_12`,name:`Mentha-type`,color:`#38bdf8`,startX:1193,endX:1225,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_12_0`,x:1195,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_12_306`,x:1193,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_12_307`,x:1225,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_12_309`,x:1195,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_12_313`,x:1193,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_12_601`,x:1193,y:1112,type:`transition`,isManual:!1,createdAt:1700000000601},{id:`pt_12_617`,x:1196,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_12_618`,x:1225,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_12_620`,x:1196,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_12_668`,x:1193,y:1179,type:`transition`,isManual:!1,createdAt:1700000000668},{id:`pt_12_794`,x:1193,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_12_796`,x:1225,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_12_799`,x:1195,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_13`,name:`Anthemis-type`,color:`#34d399`,startX:1225,endX:1255,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_13_0`,x:1227,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_13_306`,x:1225,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_13_307`,x:1255,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_13_309`,x:1227,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_13_313`,x:1225,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_13_617`,x:1227,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_13_618`,x:1255,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_13_620`,x:1227,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_13_794`,x:1229,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_13_795`,x:1255,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_13_799`,x:1227,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_14`,name:`Artemisia`,color:`#fbbf24`,startX:1255,endX:1330,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_14_0`,x:1257,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_14_2`,x:1268,y:513,type:`transition`,isManual:!1,createdAt:1700000000002},{id:`pt_14_108`,x:1257,y:619,type:`transition`,isManual:!1,createdAt:1700000000108},{id:`pt_14_147`,x:1264,y:658,type:`transition`,isManual:!1,createdAt:1700000000147},{id:`pt_14_306`,x:1259,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_14_307`,x:1330,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_14_309`,x:1259,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_14_453`,x:1266,y:964,type:`transition`,isManual:!1,createdAt:1700000000453},{id:`pt_14_475`,x:1282,y:986,type:`transition`,isManual:!1,createdAt:1700000000475},{id:`pt_14_496`,x:1266,y:1007,type:`transition`,isManual:!1,createdAt:1700000000496},{id:`pt_14_517`,x:1270,y:1028,type:`transition`,isManual:!1,createdAt:1700000000517},{id:`pt_14_581`,x:1257,y:1092,type:`transition`,isManual:!1,createdAt:1700000000581},{id:`pt_14_617`,x:1265,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_14_618`,x:1330,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_14_620`,x:1265,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_14_668`,x:1271,y:1179,type:`transition`,isManual:!1,createdAt:1700000000668},{id:`pt_14_687`,x:1258,y:1198,type:`transition`,isManual:!1,createdAt:1700000000687},{id:`pt_14_709`,x:1300,y:1220,type:`transition`,isManual:!1,createdAt:1700000000709},{id:`pt_14_732`,x:1279,y:1243,type:`transition`,isManual:!1,createdAt:1700000000732},{id:`pt_14_752`,x:1280,y:1263,type:`transition`,isManual:!1,createdAt:1700000000752},{id:`pt_14_774`,x:1314,y:1285,type:`transition`,isManual:!1,createdAt:1700000000774},{id:`pt_14_794`,x:1303,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_14_796`,x:1330,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_14_799`,x:1257,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_15`,name:`Caryophyllaceae`,color:`#a78bfa`,startX:1330,endX:1362,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_15_0`,x:1332,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_15_306`,x:1330,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_15_307`,x:1362,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_15_309`,x:1332,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_15_313`,x:1330,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_15_354`,x:1333,y:865,type:`transition`,isManual:!1,createdAt:1700000000354},{id:`pt_15_410`,x:1330,y:921,type:`transition`,isManual:!1,createdAt:1700000000410},{id:`pt_15_617`,x:1330,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_15_618`,x:1362,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_15_620`,x:1332,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_15_623`,x:1330,y:1134,type:`transition`,isManual:!1,createdAt:1700000000623},{id:`pt_15_794`,x:1330,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_15_795`,x:1362,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_15_799`,x:1332,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_16`,name:`Chenopodiaceae`,color:`#f472b6`,startX:1362,endX:1436,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_16_0`,x:1364,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_16_2`,x:1410,y:513,type:`transition`,isManual:!1,createdAt:1700000000002},{id:`pt_16_22`,x:1395,y:533,type:`transition`,isManual:!1,createdAt:1700000000022},{id:`pt_16_46`,x:1406,y:557,type:`transition`,isManual:!1,createdAt:1700000000046},{id:`pt_16_87`,x:1366,y:598,type:`transition`,isManual:!1,createdAt:1700000000087},{id:`pt_16_149`,x:1383,y:660,type:`transition`,isManual:!1,createdAt:1700000000149},{id:`pt_16_196`,x:1367,y:707,type:`transition`,isManual:!1,createdAt:1700000000196},{id:`pt_16_306`,x:1369,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_16_307`,x:1436,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_16_309`,x:1368,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_16_321`,x:1367,y:832,type:`transition`,isManual:!1,createdAt:1700000000321},{id:`pt_16_427`,x:1397,y:938,type:`transition`,isManual:!1,createdAt:1700000000427},{id:`pt_16_496`,x:1369,y:1007,type:`transition`,isManual:!1,createdAt:1700000000496},{id:`pt_16_602`,x:1396,y:1113,type:`transition`,isManual:!1,createdAt:1700000000602},{id:`pt_16_617`,x:1384,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_16_618`,x:1436,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_16_624`,x:1378,y:1135,type:`transition`,isManual:!1,createdAt:1700000000624},{id:`pt_16_708`,x:1406,y:1219,type:`transition`,isManual:!1,createdAt:1700000000708},{id:`pt_16_733`,x:1381,y:1244,type:`transition`,isManual:!1,createdAt:1700000000733},{id:`pt_16_773`,x:1413,y:1284,type:`transition`,isManual:!1,createdAt:1700000000773},{id:`pt_16_794`,x:1402,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_16_796`,x:1436,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_16_799`,x:1364,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_17`,name:`Cruciferae`,color:`#fb7185`,startX:1436,endX:1468,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_17_0`,x:1438,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_17_306`,x:1436,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_17_307`,x:1468,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_17_309`,x:1438,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_17_313`,x:1436,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_17_360`,x:1440,y:871,type:`transition`,isManual:!1,createdAt:1700000000360},{id:`pt_17_432`,x:1436,y:943,type:`transition`,isManual:!1,createdAt:1700000000432},{id:`pt_17_617`,x:1436,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_17_618`,x:1468,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_17_620`,x:1438,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_17_623`,x:1436,y:1134,type:`transition`,isManual:!1,createdAt:1700000000623},{id:`pt_17_686`,x:1436,y:1197,type:`transition`,isManual:!1,createdAt:1700000000686},{id:`pt_17_703`,x:1440,y:1214,type:`transition`,isManual:!1,createdAt:1700000000703},{id:`pt_17_760`,x:1440,y:1271,type:`transition`,isManual:!1,createdAt:1700000000760},{id:`pt_17_794`,x:1436,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_17_795`,x:1468,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_17_799`,x:1438,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_18`,name:`Filipendula`,color:`#2dd4bf`,startX:1468,endX:1500,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_18_0`,x:1470,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_18_306`,x:1468,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_18_307`,x:1500,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_18_309`,x:1470,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_18_313`,x:1468,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_18_617`,x:1468,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_18_618`,x:1500,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_18_620`,x:1470,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_18_623`,x:1468,y:1134,type:`transition`,isManual:!1,createdAt:1700000000623},{id:`pt_18_794`,x:1468,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_18_795`,x:1500,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_18_799`,x:1470,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_19`,name:`Gramineae <40um`,color:`#818cf8`,startX:1500,endX:1552,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_19_0`,x:1502,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_19_2`,x:1541,y:513,type:`transition`,isManual:!1,createdAt:1700000000002},{id:`pt_19_24`,x:1513,y:535,type:`transition`,isManual:!1,createdAt:1700000000024},{id:`pt_19_47`,x:1510,y:558,type:`transition`,isManual:!1,createdAt:1700000000047},{id:`pt_19_68`,x:1518,y:579,type:`transition`,isManual:!1,createdAt:1700000000068},{id:`pt_19_109`,x:1502,y:620,type:`transition`,isManual:!1,createdAt:1700000000109},{id:`pt_19_306`,x:1512,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_19_307`,x:1552,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_19_311`,x:1511,y:822,type:`transition`,isManual:!1,createdAt:1700000000311},{id:`pt_19_404`,x:1518,y:915,type:`transition`,isManual:!1,createdAt:1700000000404},{id:`pt_19_431`,x:1513,y:942,type:`transition`,isManual:!1,createdAt:1700000000431},{id:`pt_19_456`,x:1520,y:967,type:`transition`,isManual:!1,createdAt:1700000000456},{id:`pt_19_495`,x:1506,y:1006,type:`transition`,isManual:!1,createdAt:1700000000495},{id:`pt_19_533`,x:1504,y:1044,type:`transition`,isManual:!1,createdAt:1700000000533},{id:`pt_19_617`,x:1511,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_19_618`,x:1552,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_19_620`,x:1512,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_19_667`,x:1515,y:1178,type:`transition`,isManual:!1,createdAt:1700000000667},{id:`pt_19_688`,x:1508,y:1199,type:`transition`,isManual:!1,createdAt:1700000000688},{id:`pt_19_708`,x:1522,y:1219,type:`transition`,isManual:!1,createdAt:1700000000708},{id:`pt_19_777`,x:1515,y:1288,type:`transition`,isManual:!1,createdAt:1700000000777},{id:`pt_19_794`,x:1520,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_19_796`,x:1552,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_19_799`,x:1502,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_20`,name:`Gramineae >40<50um`,color:`#f97316`,startX:1552,endX:1584,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_20_0`,x:1554,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_20_2`,x:1559,y:513,type:`transition`,isManual:!1,createdAt:1700000000002},{id:`pt_20_163`,x:1555,y:674,type:`transition`,isManual:!1,createdAt:1700000000163},{id:`pt_20_174`,x:1552,y:685,type:`transition`,isManual:!1,createdAt:1700000000174},{id:`pt_20_192`,x:1552,y:703,type:`transition`,isManual:!1,createdAt:1700000000192},{id:`pt_20_213`,x:1557,y:724,type:`transition`,isManual:!1,createdAt:1700000000213},{id:`pt_20_305`,x:1557,y:816,type:`transition`,isManual:!1,createdAt:1700000000305},{id:`pt_20_307`,x:1584,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_20_309`,x:1558,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_20_342`,x:1561,y:853,type:`transition`,isManual:!1,createdAt:1700000000342},{id:`pt_20_457`,x:1561,y:968,type:`transition`,isManual:!1,createdAt:1700000000457},{id:`pt_20_497`,x:1555,y:1008,type:`transition`,isManual:!1,createdAt:1700000000497},{id:`pt_20_617`,x:1555,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_20_618`,x:1584,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_20_620`,x:1555,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_20_731`,x:1555,y:1242,type:`transition`,isManual:!1,createdAt:1700000000731},{id:`pt_20_750`,x:1559,y:1261,type:`transition`,isManual:!1,createdAt:1700000000750},{id:`pt_20_794`,x:1556,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_20_796`,x:1584,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_20_799`,x:1554,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_21`,name:`Gramineae >50<60um`,color:`#4ade80`,startX:1584,endX:1616,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_21_0`,x:1586,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_21_192`,x:1584,y:703,type:`transition`,isManual:!1,createdAt:1700000000192},{id:`pt_21_306`,x:1589,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_21_307`,x:1616,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_21_312`,x:1588,y:823,type:`transition`,isManual:!1,createdAt:1700000000312},{id:`pt_21_414`,x:1591,y:925,type:`transition`,isManual:!1,createdAt:1700000000414},{id:`pt_21_499`,x:1584,y:1010,type:`transition`,isManual:!1,createdAt:1700000000499},{id:`pt_21_617`,x:1584,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_21_618`,x:1616,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_21_623`,x:1585,y:1134,type:`transition`,isManual:!1,createdAt:1700000000623},{id:`pt_21_671`,x:1589,y:1182,type:`transition`,isManual:!1,createdAt:1700000000671},{id:`pt_21_794`,x:1584,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_21_796`,x:1616,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_21_799`,x:1586,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_22`,name:`Gramineae >60um`,color:`#e879f9`,startX:1616,endX:1648,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_22_0`,x:1618,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_22_306`,x:1618,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_22_307`,x:1648,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_22_309`,x:1618,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_22_358`,x:1621,y:869,type:`transition`,isManual:!1,createdAt:1700000000358},{id:`pt_22_430`,x:1619,y:941,type:`transition`,isManual:!1,createdAt:1700000000430},{id:`pt_22_455`,x:1623,y:966,type:`transition`,isManual:!1,createdAt:1700000000455},{id:`pt_22_472`,x:1618,y:983,type:`transition`,isManual:!1,createdAt:1700000000472},{id:`pt_22_499`,x:1616,y:1010,type:`transition`,isManual:!1,createdAt:1700000000499},{id:`pt_22_557`,x:1616,y:1068,type:`transition`,isManual:!1,createdAt:1700000000557},{id:`pt_22_571`,x:1619,y:1082,type:`transition`,isManual:!1,createdAt:1700000000571},{id:`pt_22_617`,x:1616,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_22_618`,x:1648,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_22_620`,x:1618,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_22_623`,x:1616,y:1134,type:`transition`,isManual:!1,createdAt:1700000000623},{id:`pt_22_794`,x:1616,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_22_795`,x:1648,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_22_799`,x:1618,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_23`,name:`Liguliflorae`,color:`#60a5fa`,startX:1648,endX:1680,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_23_0`,x:1650,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_23_306`,x:1648,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_23_307`,x:1680,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_23_309`,x:1650,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_23_313`,x:1648,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_23_335`,x:1651,y:846,type:`transition`,isManual:!1,createdAt:1700000000335},{id:`pt_23_601`,x:1648,y:1112,type:`transition`,isManual:!1,createdAt:1700000000601},{id:`pt_23_617`,x:1651,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_23_618`,x:1680,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_23_620`,x:1651,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_23_668`,x:1648,y:1179,type:`transition`,isManual:!1,createdAt:1700000000668},{id:`pt_23_794`,x:1648,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_23_796`,x:1680,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_23_799`,x:1650,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_24`,name:`Plantago coronopus`,color:`#38bdf8`,startX:1680,endX:1711,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_24_0`,x:1682,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_24_23`,x:1689,y:534,type:`transition`,isManual:!1,createdAt:1700000000023},{id:`pt_24_45`,x:1689,y:556,type:`transition`,isManual:!1,createdAt:1700000000045},{id:`pt_24_77`,x:1682,y:588,type:`transition`,isManual:!1,createdAt:1700000000077},{id:`pt_24_155`,x:1685,y:666,type:`transition`,isManual:!1,createdAt:1700000000155},{id:`pt_24_174`,x:1680,y:685,type:`transition`,isManual:!1,createdAt:1700000000174},{id:`pt_24_299`,x:1680,y:810,type:`transition`,isManual:!1,createdAt:1700000000299},{id:`pt_24_306`,x:1682,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_24_307`,x:1711,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_24_309`,x:1682,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_24_341`,x:1685,y:852,type:`transition`,isManual:!1,createdAt:1700000000341},{id:`pt_24_414`,x:1682,y:925,type:`transition`,isManual:!1,createdAt:1700000000414},{id:`pt_24_438`,x:1685,y:949,type:`transition`,isManual:!1,createdAt:1700000000438},{id:`pt_24_476`,x:1680,y:987,type:`transition`,isManual:!1,createdAt:1700000000476},{id:`pt_24_617`,x:1680,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_24_618`,x:1711,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_24_620`,x:1682,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_24_623`,x:1680,y:1134,type:`transition`,isManual:!1,createdAt:1700000000623},{id:`pt_24_794`,x:1680,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_24_795`,x:1711,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_24_799`,x:1682,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_25`,name:`Pteridium`,color:`#34d399`,startX:1711,endX:1743,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_25_0`,x:1713,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_25_160`,x:1715,y:671,type:`transition`,isManual:!1,createdAt:1700000000160},{id:`pt_25_192`,x:1711,y:703,type:`transition`,isManual:!1,createdAt:1700000000192},{id:`pt_25_278`,x:1715,y:789,type:`transition`,isManual:!1,createdAt:1700000000278},{id:`pt_25_306`,x:1711,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_25_307`,x:1743,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_25_309`,x:1713,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_25_313`,x:1711,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_25_391`,x:1715,y:902,type:`transition`,isManual:!1,createdAt:1700000000391},{id:`pt_25_601`,x:1711,y:1112,type:`transition`,isManual:!1,createdAt:1700000000601},{id:`pt_25_617`,x:1713,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_25_618`,x:1743,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_25_620`,x:1713,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_25_794`,x:1711,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_25_795`,x:1743,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_25_799`,x:1713,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_26`,name:`Filicales`,color:`#fbbf24`,startX:1743,endX:1774,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_26_0`,x:1745,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_26_42`,x:1743,y:553,type:`transition`,isManual:!1,createdAt:1700000000042},{id:`pt_26_96`,x:1747,y:607,type:`transition`,isManual:!1,createdAt:1700000000096},{id:`pt_26_108`,x:1746,y:619,type:`transition`,isManual:!1,createdAt:1700000000108},{id:`pt_26_110`,x:1743,y:621,type:`transition`,isManual:!1,createdAt:1700000000110},{id:`pt_26_306`,x:1743,y:817,type:`transition`,isManual:!1,createdAt:1700000000306},{id:`pt_26_307`,x:1774,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_26_309`,x:1745,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_26_313`,x:1743,y:824,type:`transition`,isManual:!1,createdAt:1700000000313},{id:`pt_26_450`,x:1743,y:961,type:`transition`,isManual:!1,createdAt:1700000000450},{id:`pt_26_466`,x:1747,y:977,type:`transition`,isManual:!1,createdAt:1700000000466},{id:`pt_26_617`,x:1745,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_26_618`,x:1774,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_26_620`,x:1745,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_26_625`,x:1743,y:1136,type:`transition`,isManual:!1,createdAt:1700000000625},{id:`pt_26_794`,x:1743,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_26_795`,x:1774,y:1306,type:`transition`,isManual:!1,createdAt:1700000000795},{id:`pt_26_799`,x:1745,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_27`,name:`Pollen Concentration`,color:`#a78bfa`,startX:1774,endX:1845,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_27_0`,x:1776,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_27_2`,x:1783,y:513,type:`transition`,isManual:!1,createdAt:1700000000002},{id:`pt_27_23`,x:1779,y:534,type:`transition`,isManual:!1,createdAt:1700000000023},{id:`pt_27_43`,x:1788,y:554,type:`transition`,isManual:!1,createdAt:1700000000043},{id:`pt_27_79`,x:1783,y:590,type:`transition`,isManual:!1,createdAt:1700000000079},{id:`pt_27_139`,x:1781,y:650,type:`transition`,isManual:!1,createdAt:1700000000139},{id:`pt_27_191`,x:1786,y:702,type:`transition`,isManual:!1,createdAt:1700000000191},{id:`pt_27_216`,x:1783,y:727,type:`transition`,isManual:!1,createdAt:1700000000216},{id:`pt_27_237`,x:1816,y:748,type:`transition`,isManual:!1,createdAt:1700000000237},{id:`pt_27_259`,x:1806,y:770,type:`transition`,isManual:!1,createdAt:1700000000259},{id:`pt_27_300`,x:1845,y:811,type:`transition`,isManual:!1,createdAt:1700000000300},{id:`pt_27_303`,x:1776,y:814,type:`transition`,isManual:!1,createdAt:1700000000303},{id:`pt_27_554`,x:1776,y:1065,type:`transition`,isManual:!1,createdAt:1700000000554},{id:`pt_27_555`,x:1845,y:1066,type:`transition`,isManual:!1,createdAt:1700000000555},{id:`pt_27_560`,x:1839,y:1071,type:`transition`,isManual:!1,createdAt:1700000000560},{id:`pt_27_566`,x:1845,y:1077,type:`transition`,isManual:!1,createdAt:1700000000566},{id:`pt_27_567`,x:1776,y:1078,type:`transition`,isManual:!1,createdAt:1700000000567},{id:`pt_27_768`,x:1776,y:1279,type:`transition`,isManual:!1,createdAt:1700000000768},{id:`pt_27_769`,x:1845,y:1280,type:`transition`,isManual:!1,createdAt:1700000000769},{id:`pt_27_794`,x:1803,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_27_796`,x:1845,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_27_799`,x:1776,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]},{id:`taxa_28`,name:`Col 28`,color:`#f472b6`,startX:1845,endX:1946,maxPercent:20,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[{id:`pt_28_0`,x:1845,y:511,type:`transition`,isManual:!1,createdAt:17e11},{id:`pt_28_300`,x:1845,y:811,type:`transition`,isManual:!1,createdAt:1700000000300},{id:`pt_28_307`,x:1946,y:818,type:`transition`,isManual:!1,createdAt:1700000000307},{id:`pt_28_309`,x:1875,y:820,type:`transition`,isManual:!1,createdAt:1700000000309},{id:`pt_28_324`,x:1927,y:835,type:`transition`,isManual:!1,createdAt:1700000000324},{id:`pt_28_366`,x:1847,y:877,type:`transition`,isManual:!1,createdAt:1700000000366},{id:`pt_28_409`,x:1909,y:920,type:`transition`,isManual:!1,createdAt:1700000000409},{id:`pt_28_430`,x:1863,y:941,type:`transition`,isManual:!1,createdAt:1700000000430},{id:`pt_28_454`,x:1886,y:965,type:`transition`,isManual:!1,createdAt:1700000000454},{id:`pt_28_517`,x:1847,y:1028,type:`transition`,isManual:!1,createdAt:1700000000517},{id:`pt_28_539`,x:1877,y:1050,type:`transition`,isManual:!1,createdAt:1700000000539},{id:`pt_28_557`,x:1845,y:1068,type:`transition`,isManual:!1,createdAt:1700000000557},{id:`pt_28_581`,x:1868,y:1092,type:`transition`,isManual:!1,createdAt:1700000000581},{id:`pt_28_617`,x:1856,y:1128,type:`transition`,isManual:!1,createdAt:1700000000617},{id:`pt_28_618`,x:1946,y:1129,type:`transition`,isManual:!1,createdAt:1700000000618},{id:`pt_28_620`,x:1858,y:1131,type:`transition`,isManual:!1,createdAt:1700000000620},{id:`pt_28_666`,x:1856,y:1177,type:`transition`,isManual:!1,createdAt:1700000000666},{id:`pt_28_692`,x:1889,y:1203,type:`transition`,isManual:!1,createdAt:1700000000692},{id:`pt_28_732`,x:1855,y:1243,type:`transition`,isManual:!1,createdAt:1700000000732},{id:`pt_28_754`,x:1884,y:1265,type:`transition`,isManual:!1,createdAt:1700000000754},{id:`pt_28_794`,x:1845,y:1305,type:`transition`,isManual:!1,createdAt:1700000000794},{id:`pt_28_796`,x:1946,y:1307,type:`transition`,isManual:!1,createdAt:1700000000796},{id:`pt_28_799`,x:1845,y:1310,type:`transition`,isManual:!1,createdAt:1700000000799}]}],activeTaxaId:`taxa_1`,selectedEntity:null}}static getVerificationDiagramData(){let e={dataXMin:120,dataXMax:1020,dataYMin:80,dataYMax:420,depthTopValue:0,depthBottomValue:120,unit:`m`,depthInterval:2,depthGridEnabled:!0,isCalibrated:!0},t=e.dataYMin,n=e.dataYMax;return{imageSrc:`./verification_pollen.png`,imageWidth:1130,imageHeight:498,calibration:e,columns:[{id:`taxa_betula`,name:`Betula nana`,color:`#38bdf8`,startX:120,endX:340,maxPercent:60,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(120,220,t,n,[.1,.2,.4,.6,.75,.8,.65,.5,.35,.2])},{id:`taxa_alnus`,name:`Alnus viridis`,color:`#34d399`,startX:340,endX:560,maxPercent:50,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(340,220,t,n,[.4,.45,.5,.4,.3,.25,.35,.5,.6,.55])},{id:`taxa_artemisia`,name:`Artemisia sp.`,color:`#fbbf24`,startX:560,endX:780,maxPercent:40,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(560,220,t,n,[.7,.6,.45,.3,.2,.15,.1,.15,.25,.4])},{id:`taxa_cyperaceae`,name:`Cyperaceae`,color:`#f472b6`,startX:780,endX:1e3,maxPercent:40,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(780,220,t,n,[.2,.25,.3,.35,.4,.5,.6,.65,.55,.4])}],activeTaxaId:`taxa_betula`,selectedEntity:null}}static getBeginnerDiagramData(){let e={dataXMin:220,dataXMax:1750,dataYMin:280,dataYMax:1550,depthTopValue:0,depthBottomValue:300,unit:`cm`,isCalibrated:!0,depthInterval:5,depthGridEnabled:!0},t=e.dataYMin,n=e.dataYMax;return{imageSrc:`./beginner-tutorial.png`,imageWidth:1923,imageHeight:1796,calibration:e,columns:[{id:`taxa_quercus`,name:`Quercus robur`,color:`#38bdf8`,startX:220,endX:520,maxPercent:80,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(220,300,t,n,[.8,.85,.7,.6,.55,.5,.65,.7,.8,.75,.7])},{id:`taxa_fagus`,name:`Fagus sylvatica`,color:`#34d399`,startX:520,endX:820,maxPercent:60,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(520,300,t,n,[.1,.15,.25,.4,.55,.6,.5,.4,.3,.2,.15])},{id:`taxa_corylus`,name:`Corylus avellana`,color:`#fbbf24`,startX:820,endX:1120,maxPercent:50,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(820,300,t,n,[.3,.4,.5,.45,.35,.25,.2,.3,.35,.4,.45])},{id:`taxa_picea`,name:`Picea abies`,color:`#a78bfa`,startX:1120,endX:1420,maxPercent:40,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(1120,300,t,n,[.15,.2,.25,.3,.4,.45,.35,.25,.2,.15,.1])},{id:`taxa_herbaceous`,name:`Total Herbs`,color:`#fb7185`,startX:1420,endX:1720,maxPercent:50,tickEndX:0,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:this.generatePoints(1420,300,t,n,[.4,.35,.3,.25,.2,.15,.2,.3,.35,.4,.45])}],activeTaxaId:`taxa_quercus`,selectedEntity:null}}static getSampleDiagram(e){switch(e){case`verification`:return this.getVerificationDiagramData();case`beginner`:return this.getBeginnerDiagramData();default:return this.getHoyaDiagramData()}}static createInitialSuggestion(e,t,n,r=`User Diagram`){let i=Math.max(200,e),a=Math.max(200,t);return{imageSrc:n,imageWidth:i,imageHeight:a,calibration:{dataXMin:Math.round(i*.12),dataXMax:Math.round(i*.94),dataYMin:Math.round(a*.18),dataYMax:Math.round(a*.88),depthTopValue:0,depthBottomValue:100,unit:`cm`,isCalibrated:!0,depthInterval:2,depthGridEnabled:!0,isCalibrated:!0},columns:[],activeTaxaId:``,selectedEntity:{type:`roi`}}}static createColumnsFromRoi(e){let t=e.dataXMax-e.dataXMin,n=Math.max(2,Math.min(12,Math.round(t/140))),r=Math.round(t/n),i=[`#38bdf8`,`#34d399`,`#fbbf24`,`#a78bfa`,`#f472b6`,`#fb7185`,`#2dd4bf`,`#818cf8`],a=[];for(let t=0;t<n;t++){let o=e.dataXMin+t*r,s=t===n-1?e.dataXMax:o+r,c=`Taxon ${t+1}`,l=i[t%i.length];a.push({id:`taxa_auto_${Date.now()}_${t}`,name:c,color:l,startX:o,endX:s,maxPercent:100,tickEndX:s,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[],scale_type:`linear`,startValue:0,tickValue:100,plotType:`area`})}return a}},t=class{static buildPath(e,t=`linear`){let n=new Path2D;if(e.length===0)return n;if(e.length===1)return n.moveTo(e[0].x,e[0].y),n.lineTo(e[0].x+.1,e[0].y),n;n.moveTo(e[0].x,e[0].y);for(let t=1;t<e.length;t++)n.lineTo(e[t].x,e[t].y);return n}static buildAreaPath(e,t,n=`linear`){let r=new Path2D;if(e.length<2)return r;let i=e[0],a=e[e.length-1];r.moveTo(t,i.y),r.lineTo(i.x,i.y);for(let t=1;t<e.length;t++)r.lineTo(e[t].x,e[t].y);return r.lineTo(t,a.y),r.closePath(),r}static resample(e,t=2){if(e.length===0)return[];if(e.length===1)return[{...e[0]}];let n=[],r=e[0].y,i=e[e.length-1].y;for(let a=r;a<=i;a+=t){let t=0;for(;t<e.length-1&&e[t+1].y<a;)t++;if(t>=e.length-1){n.push({x:e[e.length-1].x,y:a});continue}let r=e[t],i=e[t+1],o=(a-r.y)/(i.y-r.y||1),s=Math.max(0,Math.min(1,o)),c=r.x+(i.x-r.x)*s;n.push({x:c,y:a})}return n}static interpolatePercentAtY(e,t){let n=e.controlPoints,r=e.endX-e.startX;if(n.length===0||r<=0)return 0;let i=[...n].sort((e,t)=>e.y-t.y),a;if(t<=i[0].y)a=i[0].x;else if(t>=i[i.length-1].y)a=i[i.length-1].x;else{let n=0;for(;n<i.length-1&&i[n+1].y<t;)n++;let r=i[n],o=i[n+1],s=o.y-r.y,c=s===0?0:(t-r.y)/s,l=Math.max(0,Math.min(1,c));if(e.curveType===`bezier`&&i.length>=3){let e=n>0?i[n-1]:r,t=n<i.length-2?i[n+2]:o,s=.5,c=(o.x-e.x)*s,u=(t.x-r.x)*s,d=r.x+c/3,f=o.x-u/3,p=1-l;a=p*p*p*r.x+3*p*p*l*d+3*p*l*l*f+l*l*l*o.x}else a=r.x+(o.x-r.x)*l}let o=e.scaleCalib;if(o&&o.calibX!==o.originX){let e=o.calibX-o.originX,t=(o.calibVal-o.originVal)/e,n=o.originVal+(a-o.originX)*t;return Number(n.toFixed(2))}let s=e.tickEndX&&e.tickEndX>e.startX?e.tickEndX-e.startX:e.endX-e.startX,c=e.maxPercent??100,l=(a-e.startX)/(s||1)*c;return Number(Math.max(0,l).toFixed(2))}static getStandardDepthHorizons(e){let t=e.depthInterval&&e.depthInterval>0?e.depthInterval:2,n=e.depthTopValue,r=e.depthBottomValue,i=r-n||1,a=e.dataYMax-e.dataYMin,o=Math.min(n,r),s=Math.max(n,r),c=n<=r,l=Math.round((s-o)/t),u=[],d=[];for(let r=0;r<=l;r++){let o=Number((c?n+r*t:n-r*t).toFixed(4)),s=(o-n)/i,l=Number((e.dataYMin+s*a).toFixed(2));u.push(o),d.push(l)}return{depths:u,yPositions:d}}static extractAnchoredDepthTable(e,t){let{depths:n,yPositions:r}=this.getStandardDepthHorizons(t),i=e.filter(e=>e.visible);return n.map((e,n)=>{let a=r[n],o={};for(let e of i)o[e.name]=this.interpolatePercentAtY(e,a);return{depth:e,unit:t.unit,y:a,values:o}})}},n=class{endpoint;isMock=!0;isDesktopMode=!1;requestId=1;currentDiagramData;onStatusChange=null;constructor(t){this.endpoint=t||(typeof window<`u`&&window.location.origin&&window.location.origin.startsWith(`http`)?`${window.location.origin}/rpc`:`http://127.0.0.1:8765/rpc`),this.currentDiagramData=e.createDefaultDiagramData()}setStatusCallback(e){this.onStatusChange=e}getStatus(){return{connected:!this.isMock,isMock:this.isMock,endpoint:this.endpoint,latencyMs:this.isMock?0:5,isDesktopMode:this.isDesktopMode}}async probeBackend(e){let t=[];if(e&&t.push(e),typeof window<`u`&&window.location&&window.location.origin&&window.location.origin.startsWith(`http`)){let e=window.location.origin+`/rpc`;t.includes(e)||t.push(e)}let n=`http://127.0.0.1:8765/rpc`;t.includes(n)||t.push(n);for(let e of t)try{let t=new AbortController,n=setTimeout(()=>t.abort(),1e3),r={jsonrpc:`2.0`,id:++this.requestId,method:`system.ping`,params:{}},i=await fetch(e,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(r),signal:t.signal});if(clearTimeout(n),i.ok){let t=await i.json();if(t&&!t.error){this.endpoint=e,this.isMock=!1;try{let t=e.replace(/\/rpc$/,`/status`),n=await fetch(t);if(n.ok){let e=await n.json();e&&typeof e.is_desktop_mode==`boolean`&&(this.isDesktopMode=e.is_desktop_mode)}}catch{}return this.notifyStatus(),this.getStatus()}}}catch{}return this.isMock=!0,this.notifyStatus(),this.getStatus()}notifyStatus(){this.onStatusChange&&this.onStatusChange(this.getStatus())}async call(e,t){if(!this.isMock)try{let n={jsonrpc:`2.0`,id:++this.requestId,method:e,params:t},r=await fetch(this.endpoint,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(n)});if(r.ok){let e=await r.json();if(e.error)throw Error(`RPC Error [${e.error.code}]: ${e.error.message}`);return e.result}}catch(t){console.warn(`Backend RPC call ${e} failed, falling back to Mock:`,t),this.isMock=!0,this.notifyStatus()}return this.mockExecute(e,t)}async mockExecute(t,n){switch(await new Promise(e=>setTimeout(e,25)),t){case`core.loadImage`:{let t=n;return t?.sample_key&&(this.currentDiagramData=e.getSampleDiagram(t.sample_key)),JSON.parse(JSON.stringify(this.currentDiagramData))}case`straditize.getDiagramData`:return JSON.parse(JSON.stringify(this.currentDiagramData));case`core.updateControlPoint`:{let e=n,t=this.currentDiagramData.columns[e.col_index];if(t){if(e.remove)t.controlPoints=t.controlPoints.filter(t=>Math.abs(t.y-e.row)>6);else{let n=t.controlPoints.find(t=>Math.abs(t.y-e.row)<=4);n?(n.x=e.x,n.y=e.row,n.isManual=!0):(t.controlPoints.push({id:`pt_${Date.now()}_${Math.random().toString(36).substring(2,6)}`,x:e.x,y:e.row,type:`manual`,isManual:!0,createdAt:Date.now()}),t.controlPoints.sort((e,t)=>e.y-t.y))}return{col_index:e.col_index,action:e.remove?`removed`:`updated`,points:t.controlPoints}}return!0}case`core.digitize`:{let e=n,t=this.currentDiagramData.columns[e.col_index];return t?(t.controlPoints.forEach(e=>{e.isManual||(e.x+=(Math.random()-.5)*4)}),{col_index:e.col_index,points:t.controlPoints}):{points:[]}}case`core.exportData`:{let e=n;return this.generateExportData(e?.format||`csv`)}default:return!0}}async getDiagramData(){return this.call(`straditize.getDiagramData`)}async loadSampleDiagram(t){let n=e.getSampleDiagram(t);if(this.currentDiagramData=JSON.parse(JSON.stringify(n)),!this.isMock)try{await this.call(`core.loadImage`,{sample_key:t,image_path:n.imageSrc})}catch(e){console.warn(`Backend load sample sync failed:`,e)}return this.currentDiagramData}async loadCustomImage(t,n,r,i=`Custom Diagram`){let a=e.createInitialSuggestion(n,r,t,i);if(this.currentDiagramData=a,!this.isMock)try{let e=t.startsWith(`data:`),a={file_name:i,width:n,height:r};e?a.image_data=t:a.image_path=t;let o=await this.call(`core.loadImage`,a);this.currentDiagramData.columns=[],this.currentDiagramData.activeTaxaId=``,o&&o.width&&o.height&&(this.currentDiagramData.imageWidth=o.width,this.currentDiagramData.imageHeight=o.height)}catch(e){console.warn(`Backend loadImage notification failed, using client suggested layout:`,e)}return this.currentDiagramData}async detectColumnsInRoi(t){if(this.isMock){let n=this.currentDiagramData.calibration;n.dataXMin=t.x0,n.dataXMax=t.x1,n.dataYMin=t.y0,n.dataYMax=t.y1;let r=e.createColumnsFromRoi(n);return this.currentDiagramData.columns=r,this.currentDiagramData.activeTaxaId=r[0]?.id||``,r}try{let e=await this.call(`core.detectColumns`,{x_bounds:[t.x0,t.x1],y_bounds:[t.y0,t.y1]});if(Array.isArray(e)&&e.length>0){let t=[`#38bdf8`,`#34d399`,`#fbbf24`,`#a78bfa`,`#f472b6`,`#fb7185`,`#2dd4bf`,`#818cf8`],n=e.map((e,n)=>({id:`taxa_${e.col_index??n}`,name:e.name||`Taxon ${n+1}`,color:t[n%t.length],startX:e.start,endX:e.end,maxPercent:100,tickEndX:e.tickEndX||e.end,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[],scale_type:e.scale_type||`linear`,startValue:e.startValue||0,tickValue:e.tickValue||100,plotType:e.plot_type||`area`,hasExaggeration:e.has_exaggeration||!1,exaggerationMult:e.exaggeration_multiplier||5}));return this.currentDiagramData.columns=n,this.currentDiagramData.activeTaxaId=n[0]?.id||``,n}}catch(e){console.warn(`Backend detectColumns failed, fallback to ROI split:`,e)}let n=e.createColumnsFromRoi(this.currentDiagramData.calibration);return this.currentDiagramData.columns=n,this.currentDiagramData.activeTaxaId=n[0]?.id||``,n}async detectDeskew(){if(this.isMock)return{has_skew:!1,suggested_rotation_angle:0};try{return await this.call(`image.detectDeskew`)||{has_skew:!1,suggested_rotation_angle:0}}catch(e){return console.warn(`Backend detectDeskew failed:`,e),{has_skew:!1,suggested_rotation_angle:0}}}async rotateImage(e){if(this.isMock)return{success:!0,width:this.currentDiagramData.imageWidth,height:this.currentDiagramData.imageHeight};try{return await this.call(`image.rotate`,{angle:e})||{success:!1,width:0,height:0}}catch(e){return console.warn(`Backend rotateImage failed:`,e),{success:!1,width:0,height:0}}}async updateControlPoint(e,t,n,r=!1){return!!await this.call(`core.updateControlPoint`,{col_index:e,row:t,x:n,remove:r})}async digitizeColumn(e){let t=this.currentDiagramData.columns.findIndex(t=>t.id===e),n=await this.call(`core.digitize`,{col_index:Math.max(0,t)});if(n.control_points&&n.control_points.length>0)return n.control_points;let r=n.points||[];return r.length<=35?r:this.downsampleControlPoints(r,25)}downsampleControlPoints(e,t=25){if(e.length<=t)return e;let n=[...e].sort((e,t)=>e.y-t.y),r=Math.floor(n.length/(t-1)),i=[n[0]];for(let e=r;e<n.length-1;e+=r)i.push(n[e]);return i.push(n[n.length-1]),i}async exportData(e=`csv`){let t=await this.call(`core.exportData`,{format:e,strict:!1});return typeof t==`string`?t:t&&`csv_content`in t?t.csv_content:this.generateExportData(e)}generateExportData(e){let n=this.currentDiagramData,{unit:r}=n.calibration,{depths:i,yPositions:a}=t.getStandardDepthHorizons(n.calibration),o=n.columns.filter(e=>e.visible);if(e===`json`){let e={meta:{exportTime:new Date().toISOString(),calibration:n.calibration,totalHorizons:i.length,depthInterval:n.calibration.depthInterval||2,unit:r},horizons:i.map((e,n)=>{let i=a[n],s={};return o.forEach(e=>{s[e.name]=t.interpolatePercentAtY(e,i)}),{depth:e,unit:r,y_px:i,values:s}}),taxaColumns:n.columns.map(e=>({name:e.name,color:e.color,startX:e.startX,endX:e.endX,maxPercent:e.maxPercent,curveType:e.curveType,visible:e.visible,controlPointsCount:e.controlPoints.length}))};return JSON.stringify(e,null,2)}let s=[[`Depth (${r})`,...o.map(e=>`"${e.name} (%)"`)].join(`,`)];for(let e=0;e<i.length;e++){let n=i[e],r=a[e],c=[n.toFixed(2)];o.forEach(e=>{let n=t.interpolatePercentAtY(e,r);c.push(n.toFixed(2))}),s.push(c.join(`,`))}return s.join(`
`)}},r=class{undoStack=[];redoStack=[];maxHistory=50;onChange=null;constructor(e=50){this.maxHistory=e}push(e,t,n,r){let i={timestamp:Date.now(),description:e,columns:JSON.parse(JSON.stringify(t)),activeTaxaId:n,calibration:r?JSON.parse(JSON.stringify(r)):void 0};this.undoStack.push(i),this.undoStack.length>this.maxHistory&&this.undoStack.shift(),this.redoStack=[],this.notify()}canUndo(){return this.undoStack.length>1}canRedo(){return this.redoStack.length>0}undo(){if(!this.canUndo())return null;let e=this.undoStack.pop();this.redoStack.push(e);let t=this.undoStack[this.undoStack.length-1];return this.notify(),JSON.parse(JSON.stringify(t))}redo(){if(!this.canRedo())return null;let e=this.redoStack.pop();return this.undoStack.push(e),this.notify(),JSON.parse(JSON.stringify(e))}reset(e,t,n){this.undoStack=[{timestamp:Date.now(),description:`Initial State`,columns:JSON.parse(JSON.stringify(e)),activeTaxaId:t,calibration:n?JSON.parse(JSON.stringify(n)):void 0}],this.redoStack=[],this.notify()}notify(){this.onChange&&this.onChange()}},i=class{scale=1;panX=0;panY=0;dpr=1;minScale=.1;maxScale=10;imageMode=`normal`;showBinaryOverlay=!1;showGhosting=!0;binaryThreshold=138;degridStrength=`off`;constructor(){this.updateDpr()}updateDpr(){this.dpr=window.devicePixelRatio||1}cycleImageMode(){let e=[`normal`,`invert`,`contrast`,`binary`],t=e.indexOf(this.imageMode);return this.imageMode=e[(t+1)%e.length],this.imageMode}toggleBinaryOverlay(){return this.showBinaryOverlay=!this.showBinaryOverlay,this.showBinaryOverlay}screenToWorld(e){return{x:(e.x-this.panX)/this.scale,y:(e.y-this.panY)/this.scale}}worldToScreen(e){return{x:e.x*this.scale+this.panX,y:e.y*this.scale+this.panY}}panBy(e,t){this.panX+=e,this.panY+=t}zoomAt(e,t){let n=this.scale,r=Math.min(Math.max(n*t,this.minScale),this.maxScale);if(r===n)return;let i=this.screenToWorld(e);this.scale=r,this.panX=e.x-i.x*r,this.panY=e.y-i.y*r}zoomStepAt(e,t,n=!1){let r=this.scale,i=.1;i=r<1?.1:r<4?.25:1,n&&(i*=2);let a=t?r+i:r-i;if(a=Math.round(a*100)/100,a=Math.min(Math.max(a,this.minScale),this.maxScale),a===r)return;let o=this.screenToWorld(e);this.scale=a,this.panX=e.x-o.x*a,this.panY=e.y-o.y*a}fitToScreen(e,t,n,r,i=40){if(n<=0||r<=0||e<=0||t<=0)return;let a=Math.max(10,e-i*2),o=Math.max(10,t-i*2),s=a/n,c=o/r;this.scale=Math.min(s,c,1.5),this.panX=(e-n*this.scale)/2,this.panY=(t-r*this.scale)/2}reset100(e,t,n,r){this.scale=1,this.panX=(e-n)/2,this.panY=(t-r)/2}applyTransform(e){e.setTransform(this.dpr,0,0,this.dpr,0,0),e.translate(this.panX,this.panY),e.scale(this.scale,this.scale)}},a=class{currentMode=`select`;listeners=[];constructor(e=`select`){this.currentMode=e}getMode(){return this.currentMode}setMode(e){this.currentMode!==e&&(this.currentMode=e,this.notify())}onModeChange(e){this.listeners.push(e)}notify(){for(let e of this.listeners)e(this.currentMode)}getToolDescription(e=this.currentMode){switch(e){case`select`:return{name:`选择与微调`,shortcut:`V`,hint:`选择图元 / 拖动选中项 / 单击空白处取消选择`,cursor:`default`};case`pan`:return{name:`抓手平移`,shortcut:`H / Space`,hint:`按住鼠标左键自由平移图谱视口`,cursor:`grab`};case`roi`:return{name:`ROI 矩形数据区`,shortcut:`R`,hint:`拖拽 8 个恒定手柄微调地质数据有效区边界`,cursor:`crosshair`};case`addCol`:return{name:`添加分列线`,shortcut:`C`,hint:`在画布点击插入新属种垂直分列基线`,cursor:`crosshair`};case`addPoint`:return{name:`添加控制拐点`,shortcut:`P`,hint:`单击向当前激活属种插入强控制锚点 (自动吸附层位)`,cursor:`crosshair`};case`eraser`:return{name:`删除工具`,shortcut:`E`,hint:`点击任意控制点或分列线直接删除`,cursor:`not-allowed`};default:return{name:`选择`,shortcut:`V`,hint:`选择与微调`,cursor:`default`}}}},o=class{static screenToWorld(e,t){return{x:(e.x-t.offsetX)/t.scale,y:(e.y-t.offsetY)/t.scale}}static worldToScreen(e,t){return{x:e.x*t.scale+t.offsetX,y:e.y*t.scale+t.offsetY}}static imageYToDepth(e,t){let n=t.top_px??t.dataYMin??0,r=t.bottom_px??t.dataYMax??1e3,i=t.top_cm??t.depthTopValue??0,a=t.bottom_cm??t.depthBottomValue??150,o=r-n;if(o===0)return;let s=i+(e-n)/o*(a-i);return Number(s.toFixed(3))}static depthToImageY(e,t){let n=t.top_px??t.dataYMin??0,r=t.bottom_px??t.dataYMax??1e3,i=t.top_cm??t.depthTopValue??0,a=(t.bottom_cm??t.depthBottomValue??150)-i;if(a===0)return;let o=n+(e-i)/a*(r-n);return Math.round(o)}static getScaleRatio(e){let t=e.startX,n=e.tickEndX&&e.tickEndX>e.startX?e.tickEndX:e.endX,r=e.startValue??(e.scaleCalib?e.scaleCalib.originVal:0),i=e.tickValue??e.scaleCalib?.calibVal??e.maxPercent??100,a=Math.max(1,n-t);return Math.abs(i-r)/a}static validateLogScale(e){let t=e.startValue??(e.scaleCalib?e.scaleCalib.originVal:0),n=e.tickValue??e.scaleCalib?.calibVal??e.maxPercent??100;return e.startX===(e.tickEndX??e.endX)?{valid:!1,reason:`基线 X 与刻度终点 X 重合 (除以零)`}:t<=0?{valid:!1,reason:`对数刻度要求起点值 > 0 (当前: ${t}，ln(${t}) 无定义)`}:n<=0?{valid:!1,reason:`对数刻度要求刻度值 > 0 (当前: ${n}，ln(${n}) 无定义)`}:t===n?{valid:!1,reason:`对数刻度起点值不能等于刻度值`}:{valid:!0}}static imageXToValue(e,t){let n=t.startX,r=(t.tickEndX&&t.tickEndX!==n?t.tickEndX:t.endX)-n;if(r===0)return 0;let i=(e-n)/r,a=t.startValue??0,o=t.tickValue??t.maxPercent??100;if(t.scale_type===`log`){if(!this.validateLogScale(t).valid){let e=a+i*(o-a);return Number(e.toFixed(2))}let e=Math.log(a),n=e+i*(Math.log(o)-e);return Number(Math.exp(n).toFixed(2))}let s=a+i*(o-a);return Number(s.toFixed(2))}static imageXToPercent(e,t){return this.imageXToValue(e,t)}static valueToImageX(e,t){let n=t.startX,r=(t.tickEndX&&t.tickEndX!==n?t.tickEndX:t.endX)-n,i=t.startValue??0,a=t.tickValue??t.maxPercent??100;if(t.scale_type===`log`){if(!this.validateLogScale(t).valid||e<=0){let t=a-i||1,o=(e-i)/t;return Math.round(n+o*r)}let o=Math.log(i),s=Math.log(a),c=(Math.log(e)-o)/(s-o||1);return Math.round(n+c*r)}let o=a-i||1,s=(e-i)/o;return Math.round(n+s*r)}static percentToImageX(e,t){return this.valueToImageX(e,t)}static screenDistanceToImage(e,t){return e/t.scale}static imageDistanceToScreen(e,t){return e*t.scale}},s={color:{bg:{canvas:`#0b0f19`,canvasLight:`#f8fafc`,panel:`#111827`,panelLight:`#ffffff`,panelSecondary:`#1e293b`,panelSecondaryLight:`#f1f5f9`,toolbar:`#0f172a`,toolbarLight:`#ffffff`,card:`rgba(30, 41, 59, 0.45)`,cardLight:`rgba(241, 245, 249, 0.85)`,cardActive:`rgba(56, 189, 248, 0.12)`,cardActiveLight:`rgba(2, 132, 199, 0.10)`,input:`rgba(15, 23, 42, 0.65)`,inputLight:`#ffffff`,modalBackdrop:`rgba(0, 0, 0, 0.72)`},border:{default:`rgba(255, 255, 255, 0.08)`,defaultLight:`rgba(0, 0, 0, 0.10)`,focus:`#38bdf8`,focusLight:`#0284c7`,divider:`#334155`,dividerLight:`#e2e8f0`,danger:`rgba(239, 68, 68, 0.4)`},text:{primary:`#f8fafc`,primaryLight:`#0f172a`,secondary:`#94a3b8`,secondaryLight:`#475569`,muted:`#64748b`,mutedLight:`#94a3b8`,accent:`#38bdf8`,accentLight:`#0284c7`,danger:`#ef4444`,warning:`#f59e0b`,success:`#22c55e`},column:{baseline:`#38bdf8`,tick:`#f97316`,isolate:`#64748b`,activeBadge:`#0284c7`,boundaryHover:`#f97316`},point:{peak:`#fbbf24`,trough:`#f59e0b`,manual:`#38bdf8`,transition:`#ffffff`,hover:`#f97316`},roi:{fill:`rgba(56, 189, 248, 0.04)`,fillLight:`rgba(2, 132, 199, 0.04)`,border:`#38bdf8`,borderLight:`#0284c7`,handle:`#ffffff`,handleHover:`#f97316`},ghost:{overlayFill:`rgba(34, 197, 94, 0.28)`,overlayStroke:`#22c55e`,mismatchHighlight:`rgba(239, 68, 68, 0.65)`},mask:{pollen:`rgba(56, 189, 248, 0.92)`,degrid:`rgba(239, 68, 68, 0.92)`}},spacing:{xs:4,sm:8,md:12,lg:16,xl:24,xxl:32},radius:{sm:3,md:4,lg:6,xl:10,full:9999},font:{ui:`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,mono:`'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace`,size:{xs:9.5,sm:11,md:12,lg:13,xl:15,title:17}},panel:{leftWidth:280,rightWidth:280,minWidth:200,maxWidth:420,exportModalWidth:1180},canvas:{roiHandleSize:8,boundaryHitWidth:6,anchorHitRadius:7,pointRadius:{peak:5.5,trough:5.5,manual:5,transition:3.5},lineHitTolerance:6}},c=class{element;canvas;ctx;callbacks;isCollapsed=!1;isDragging=!1;image=null;imageWidth=1e3;imageHeight=1e3;currentScale=1;currentPanX=0;currentPanY=0;canvasWidth=800;canvasHeight=600;constructor(e,t){this.callbacks=t,this.element=document.createElement(`div`),this.element.className=`minimap-widget`,this.element.innerHTML=`
      <div class="minimap-header">
        <span class="minimap-title">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
          </svg>
          雷达鸟瞰
        </span>
        <button id="btn-toggle-minimap" class="minimap-btn" title="折叠/展开雷达图">—</button>
      </div>
      <div class="minimap-body" id="minimap-body">
        <canvas id="minimap-canvas" width="160" height="120"></canvas>
      </div>
    `,e.appendChild(this.element);let n=this.element.querySelector(`#minimap-canvas`);if(!n)throw Error(`Minimap canvas not found`);this.canvas=n;let r=n.getContext(`2d`);if(!r)throw Error(`Cannot get 2d context for minimap`);this.ctx=r,this.bindEvents()}setImage(e,t,n){this.image=e,this.imageWidth=Math.max(1,t),this.imageHeight=Math.max(1,n),this.render()}updateViewport(e,t,n){this.currentScale=e.scale,this.currentPanX=e.panX,this.currentPanY=e.panY,this.canvasWidth=Math.max(1,t),this.canvasHeight=Math.max(1,n),this.render()}render(){if(this.isCollapsed)return;let e=this.ctx;if(e.clearRect(0,0,160,120),e.fillStyle=`#0f172a`,e.fillRect(0,0,160,120),!this.image||this.imageWidth<=0||this.imageHeight<=0){e.fillStyle=`#64748b`,e.font=`10px sans-serif`,e.textAlign=`center`,e.fillText(`无图谱图像`,80,60);return}let t=Math.min(160/this.imageWidth,120/this.imageHeight),n=this.imageWidth*t,r=this.imageHeight*t,i=(160-n)/2,a=(120-r)/2;try{e.drawImage(this.image,i,a,n,r)}catch{}let o=-this.currentPanX/this.currentScale,s=-this.currentPanY/this.currentScale,c=(-this.currentPanX+this.canvasWidth)/this.currentScale,l=(-this.currentPanY+this.canvasHeight)/this.currentScale,u=i+Math.max(0,o)*t,d=a+Math.max(0,s)*t,f=Math.max(4,Math.min(this.imageWidth,c-o)*t),p=Math.max(4,Math.min(this.imageHeight,l-s)*t);e.fillStyle=`rgba(56, 189, 248, 0.15)`,e.fillRect(u,d,f,p),e.strokeStyle=`#38bdf8`,e.lineWidth=1.5,e.strokeRect(u,d,f,p),e.fillStyle=`#ffffff`,e.fillRect(u-1.5,d-1.5,3,3),e.fillRect(u+f-1.5,d-1.5,3,3),e.fillRect(u-1.5,d+p-1.5,3,3),e.fillRect(u+f-1.5,d+p-1.5,3,3)}bindEvents(){let e=this.element.querySelector(`#btn-toggle-minimap`),t=this.element.querySelector(`#minimap-body`);e?.addEventListener(`click`,n=>{n.stopPropagation(),this.isCollapsed=!this.isCollapsed,this.isCollapsed?(t.style.display=`none`,e.textContent=`□`,e.title=`展开雷达图`):(t.style.display=`block`,e.textContent=`—`,e.title=`折叠雷达图`,this.render())});let n=e=>{if(!this.image||this.imageWidth<=0||this.imageHeight<=0)return;let t=this.canvas.getBoundingClientRect(),n=e.clientX-t.left,r=e.clientY-t.top,i=Math.min(160/this.imageWidth,120/this.imageHeight),a=this.imageWidth*i,o=this.imageHeight*i,s=(160-a)/2,c=(120-o)/2,l=(n-s)/i,u=(r-c)/i,d=Math.max(0,Math.min(this.imageWidth,l)),f=Math.max(0,Math.min(this.imageHeight,u));this.callbacks.onNavigate(d,f)};this.canvas.addEventListener(`mousedown`,e=>{this.isDragging=!0,n(e)}),window.addEventListener(`mousemove`,e=>{this.isDragging&&n(e)}),window.addEventListener(`mouseup`,()=>{this.isDragging=!1})}},l=class{description;colId;point;constructor(e,t,n){this.colId=e,this.point={...t},this.description=`添加 ${n} 锚点 (X:${t.x}, Y:${t.y})`}execute(e){let t=e.columns.find(e=>e.id===this.colId);t&&(t.controlPoints.push({...this.point}),t.isLocked=!0,t.controlPoints.sort((e,t)=>e.y-t.y))}undo(e){let t=e.columns.find(e=>e.id===this.colId);t&&(t.controlPoints=t.controlPoints.filter(e=>e.id!==this.point.id))}},u=class{description;colId;deletedPoint;constructor(e,t,n){this.colId=e,this.deletedPoint={...t},this.description=`删除 ${n} 锚点 (Y:${t.y})`}execute(e){let t=e.columns.find(e=>e.id===this.colId);t&&(t.controlPoints=t.controlPoints.filter(e=>e.id!==this.deletedPoint.id),t.isLocked=!0)}undo(e){let t=e.columns.find(e=>e.id===this.colId);t&&(t.controlPoints.push({...this.deletedPoint}),t.controlPoints.sort((e,t)=>e.y-t.y))}},d=class{description;oldCal;newCal;constructor(e,t){this.oldCal={...e},this.newCal={...t},this.description=`调整地质数据有效区 (ROI)`}execute(e){e.calibration.dataXMin=this.newCal.dataXMin,e.calibration.dataXMax=this.newCal.dataXMax,e.calibration.dataYMin=this.newCal.dataYMin,e.calibration.dataYMax=this.newCal.dataYMax}undo(e){e.calibration.dataXMin=this.oldCal.dataXMin,e.calibration.dataXMax=this.oldCal.dataXMax,e.calibration.dataYMin=this.oldCal.dataYMin,e.calibration.dataYMax=this.oldCal.dataYMax}},f=class{canvas;ctx;container;dropOverlay=null;emptyStateOverlay=null;minimap=null;floatingToolbar=null;viewport;history;data;toolModeManager;callbacks;diagramImage=null;isImageLoaded=!1;binaryMonoCanvas=null;binaryMaskCanvas=null;isSpaceDown=!1;isMouseDown=!1;isPanning=!1;lastMouseScreen={x:0,y:0};dragInitialPointPos=null;dragInitialColumn=null;dragInitialCalibration=null;hoveredAnchor=null;draggingAnchor=null;hoveredBoundary=null;draggingBoundary=null;hoveredRoiHandle=null;draggingRoiHandle=null;hoveredDepthHorizon=null;isHoveringDepthRulerBadge=!1;hasDraggedAnchor=!1;renderPending=!1;ANCHOR_HIT_RADIUS_SCREEN=8;BOUNDARY_HIT_WIDTH_SCREEN=6;ROI_HANDLE_SIZE_SCREEN=8;workflowStage=3;constructor(e,t,n,r={}){this.container=e,this.data=t,this.history=n,this.callbacks=r,this.toolModeManager=new a(`select`),this.canvas=document.createElement(`canvas`),this.canvas.id=`geology-canvas`,this.canvas.className=`geology-main-canvas`,this.container.appendChild(this.canvas),this.createDropOverlay(),this.initEmptyState(),this.createFloatingToolbar();let o=this.canvas.getContext(`2d`);if(!o)throw Error(`Cannot get 2D context from canvas`);this.ctx=o,this.viewport=new i,this.minimap=new c(this.container,{onNavigate:(e,t)=>{let n=this.canvas.getBoundingClientRect();this.viewport.panX=n.width/2-e*this.viewport.scale,this.viewport.panY=n.height/2-t*this.viewport.scale,this.requestRender()}}),this.initEventListeners(),this.handleResize(),this.loadImage(this.data.imageSrc),this.history.onChange=()=>{this.requestRender(),this.callbacks.onDataChange&&this.callbacks.onDataChange()}}setToolMode(e){this.toolModeManager.setMode(e),this.updateCursor(),this.floatingToolbar&&this.floatingToolbar.querySelectorAll(`[data-fmode]`).forEach(t=>{t.getAttribute(`data-fmode`)===e?t.classList.add(`active-mode`):t.classList.remove(`active-mode`)}),this.callbacks.onToolModeChange&&this.callbacks.onToolModeChange(e)}createFloatingToolbar(){let e=document.createElement(`div`);e.className=`floating-tool-palette`,e.innerHTML=`
      <button class="floating-tool-btn active-mode" data-fmode="select" title="选择与微调模式 (快捷键: V)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
        </svg>
        <span>选择</span>
      </button>
      <button class="floating-tool-btn" data-fmode="pan" title="平移抓手模式 (快捷键: H 或按住空格/中键拖动)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>
        <span>平移</span>
      </button>
      <button class="floating-tool-btn" data-fmode="roi" title="ROI 矩形数据区模式 (快捷键: R)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="18" height="18" x="3" y="3" rx="2" stroke-dasharray="3 3"/>
        </svg>
        <span>ROI</span>
      </button>
      <button class="floating-tool-btn" data-fmode="addCol" title="添加属种列分界线 (快捷键: A)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="3 3"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>+列</span>
      </button>
      <button class="floating-tool-btn" data-fmode="addPoint" title="添加控制拐点 (快捷键: P)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="4" fill="currentColor"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
        </svg>
        <span>+点</span>
      </button>
      <button class="floating-tool-btn" data-fmode="eraser" title="橡皮擦删除工具 (快捷键: E)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>
        </svg>
        <span>橡皮</span>
      </button>
    `,this.container.appendChild(e),this.floatingToolbar=e,e.querySelectorAll(`[data-fmode]`).forEach(e=>{e.addEventListener(`click`,()=>{let t=e.getAttribute(`data-fmode`);t&&this.setToolMode(t)})})}createDropOverlay(){let e=document.createElement(`div`);e.className=`canvas-drop-overlay`,e.innerHTML=`
      <div class="drop-modal-box">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
          <path d="M12 12v9"/>
          <path d="m8 16 4-4 4 4"/>
        </svg>
        <h3>松开鼠标以载入地质图谱</h3>
        <p>支持 PNG / JPG / WebP / SVG 地学花粉与沉积剖面图像</p>
      </div>
    `,this.container.appendChild(e),this.dropOverlay=e}initEmptyState(){let e=document.createElement(`div`);e.className=`empty-canvas-container`,e.innerHTML=`
      <div class="empty-state-card">
        <div class="empty-icon-wrap">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>
        </div>
        <button id="btn-empty-load-img" class="btn btn-primary" style="padding: 8px 24px; font-size: 13px; font-weight: 600; margin-bottom: 8px; cursor: pointer;">
          📁 加载图片
        </button>
        <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 16px 0;">或将图片拖拽到此处</p>
        <div class="empty-specs-badge">
          <span>支持格式：PNG / JPG / TIFF / WebP</span>
          <span>建议尺寸：A4 600 DPI 以内</span>
          <span>最大支持：8000×12000 px</span>
        </div>
      </div>
    `,this.container.appendChild(e),this.emptyStateOverlay=e,e.querySelector(`#btn-empty-load-img`)?.addEventListener(`click`,()=>{this.callbacks.onOpenFileDialog?.()}),this.updateEmptyStateVisibility()}updateEmptyStateVisibility(){if(!this.emptyStateOverlay)return;let e=!this.data.imageSrc||this.workflowStage===0;this.emptyStateOverlay.style.display=e?`flex`:`none`}loadNewDiagram(e){this.data=e,this.loadImage(e.imageSrc),this.callbacks.onDataChange&&this.callbacks.onDataChange(),this.callbacks.onTaxaChange&&this.callbacks.onTaxaChange(e.activeTaxaId)}loadImage(e){this.isImageLoaded=!1,this.diagramImage=new Image,this.diagramImage.crossOrigin=`anonymous`,this.diagramImage.src=e,this.diagramImage.onload=()=>{this.isImageLoaded=!0,this.diagramImage&&(this.data.imageWidth=this.diagramImage.naturalWidth,this.data.imageHeight=this.diagramImage.naturalHeight),this.generateBinaryCache(),this.minimap?.setImage(this.diagramImage,this.data.imageWidth,this.data.imageHeight),this.updateEmptyStateVisibility(),this.fitToScreen(),this.requestRender()},this.diagramImage.onerror=()=>{console.warn(`Failed to load image from`,e,`using procedural canvas`),this.isImageLoaded=!0,this.requestRender()}}generateBinaryCache(){if(this.diagramImage&&this.isImageLoaded)try{let e=this.diagramImage.naturalWidth,t=this.diagramImage.naturalHeight;if(e<=0||t<=0)return;let n=4096,r=e,i=t;if(e>n||t>n){let a=n/Math.max(e,t);r=Math.max(1,Math.round(e*a)),i=Math.max(1,Math.round(t*a))}let a=document.createElement(`canvas`);a.width=r,a.height=i;let o=a.getContext(`2d`);if(!o)return;o.drawImage(this.diagramImage,0,0,r,i);let s=o.getImageData(0,0,r,i).data;this.binaryMonoCanvas=document.createElement(`canvas`),this.binaryMonoCanvas.width=r,this.binaryMonoCanvas.height=i;let c=this.binaryMonoCanvas.getContext(`2d`);this.binaryMaskCanvas=document.createElement(`canvas`),this.binaryMaskCanvas.width=r,this.binaryMaskCanvas.height=i;let l=this.binaryMaskCanvas.getContext(`2d`);if(!c||!l)return;let u=c.createImageData(r,i),d=u.data,f=l.createImageData(r,i),p=f.data,m=this.viewport.binaryThreshold,h=new Uint8Array(r*i);for(let e=0;e<i;e++){let t=e*r;for(let e=0;e<r;e++){let n=(t+e)*4,r=s[n],i=s[n+1],a=s[n+2],o=s[n+3],c=.299*r+.587*i+.114*a;o>40&&c<m&&(h[t+e]=1)}}let g=new Uint8Array(r*i);if(this.viewport.degridStrength!==`off`){let e=this.viewport.degridStrength===`weak`?55:this.viewport.degridStrength===`strong`?20:35;for(let t=0;t<i;t++){let n=t*r,i=-1;for(let t=0;t<r;t++)if(h[n+t]===1)i===-1&&(i=t);else if(i!==-1){if(t-i>=e)for(let e=i;e<t;e++)g[n+e]=1;i=-1}if(i!==-1&&r-i>=e)for(let e=i;e<r;e++)g[n+e]=1}}for(let e=0;e<i;e++){let t=e*r;for(let e=0;e<r;e++){let n=t+e,r=n*4,i=h[n]===1;g[n]===1?(d[r]=9,d[r+1]=15,d[r+2]=25,d[r+3]=255,p[r]=239,p[r+1]=68,p[r+2]=68,p[r+3]=235):i?(d[r]=255,d[r+1]=255,d[r+2]=255,d[r+3]=255,p[r]=56,p[r+1]=189,p[r+2]=248,p[r+3]=235):(d[r]=9,d[r+1]=15,d[r+2]=25,d[r+3]=255,p[r]=0,p[r+1]=0,p[r+2]=0,p[r+3]=0)}}c.putImageData(u,0,0),l.putImageData(f,0,0)}catch(e){console.warn(`Canvas pixel extraction failed (CORS or memory limitation):`,e)}}fitToScreen(){let e=this.container.getBoundingClientRect(),t=this.data.imageWidth||1600,n=this.data.imageHeight||1e3;this.viewport.fitToScreen(e.width,e.height,t,n,60),this.requestRender()}resetZoom100(){let e=this.container.getBoundingClientRect(),t=this.data.imageWidth||1600,n=this.data.imageHeight||1e3;this.viewport.reset100(e.width,e.height,t,n),this.requestRender()}handleResize(){let e=this.container.getBoundingClientRect();this.viewport.updateDpr();let t=this.viewport.dpr;this.canvas.width=Math.round(e.width*t),this.canvas.height=Math.round(e.height*t),this.canvas.style.width=`${e.width}px`,this.canvas.style.height=`${e.height}px`,this.requestRender()}requestRender(){this.renderPending||(this.renderPending=!0,requestAnimationFrame(()=>{this.renderPending=!1,this.render()}))}setActiveTaxa(e){this.data.activeTaxaId=e,this.requestRender(),this.callbacks.onTaxaChange&&this.callbacks.onTaxaChange(e)}getActiveColumn(){return this.data.columns.find(e=>e.id===this.data.activeTaxaId)}batchUpdateTaxa(e){if(!e||e.length===0)return;let t=[...this.data.columns].sort((e,t)=>e.startX-t.startX),n=t.length,r=e.length,i=Math.min(n,r);for(let n=0;n<i;n++)t[n].name=e[n];if(r>n){let i=100;if(n>=2){let e=(t[n-1].startX-t[0].startX)/(n-1);i=Math.max(40,Math.round(e))}else n===1&&(i=Math.max(40,t[0].endX-t[0].startX));let a=t[n-1],o=a?a.endX:this.data.calibration.dataXMin,s=[`#38bdf8`,`#34d399`,`#fbbf24`,`#a78bfa`,`#f472b6`,`#fb7185`,`#2dd4bf`,`#818cf8`,`#e879f9`,`#38ef7d`,`#11998e`,`#f5af19`],c=this.data.calibration,l=c.dataYMin,u=(c.dataYMax-l)/12;for(let a=n;a<r;a++){let n=o,r=n+i,c=e[a],d=s[a%s.length],f=[];for(let e=0;e<=12;e++){let t=Math.round(l+e*u),r=Math.round(n+i*.12);f.push({id:`pt_${Date.now()}_${a}_${e}`,x:r,y:t,type:e%4==0?`manual`:`transition`,isManual:e%4==0,createdAt:Date.now()+e})}let p={id:`taxa_paste_${Date.now()}_${a}`,name:c,color:d,startX:n,endX:r,tickEndX:r,maxPercent:40,unit:`%`,curveType:`linear`,visible:!0,isLocked:!1,controlPoints:f};t.push(p),o=r,r>this.data.calibration.dataXMax&&(this.data.calibration.dataXMax=r+30)}}this.data.columns=t,!t.some(e=>e.id===this.data.activeTaxaId)&&t[0]&&(this.data.activeTaxaId=t[0].id),this.history.push(`批量导入属种名单 (${e.length} 属种)`,this.data.columns,this.data.activeTaxaId,this.data.calibration),this.notifyNotice(`已成功批量导入 ${e.length} 个属种并更新分列！`),this.requestRender(),this.callbacks.onDataChange&&this.callbacks.onDataChange()}initEventListeners(){window.addEventListener(`resize`,()=>this.handleResize()),window.addEventListener(`keydown`,e=>this.onKeyDown(e)),window.addEventListener(`keyup`,e=>this.onKeyUp(e)),this.canvas.addEventListener(`wheel`,e=>this.onWheel(e),{passive:!1}),this.canvas.addEventListener(`mousedown`,e=>this.onMouseDown(e)),window.addEventListener(`mousemove`,e=>this.onMouseMove(e)),window.addEventListener(`mouseup`,e=>this.onMouseUp(e)),this.canvas.addEventListener(`contextmenu`,e=>this.onContextMenu(e)),this.initDragDrop(),this.initClipboardPaste()}initDragDrop(){let e=this.container;e.addEventListener(`dragenter`,e=>{e.preventDefault(),e.stopPropagation(),this.dropOverlay&&this.dropOverlay.classList.add(`visible`)}),e.addEventListener(`dragover`,e=>{e.preventDefault(),e.stopPropagation(),this.dropOverlay&&this.dropOverlay.classList.add(`visible`)}),e.addEventListener(`dragleave`,e=>{e.preventDefault(),e.stopPropagation(),e.target===this.dropOverlay&&this.dropOverlay&&this.dropOverlay.classList.remove(`visible`)}),e.addEventListener(`drop`,e=>{e.preventDefault(),e.stopPropagation(),this.dropOverlay&&this.dropOverlay.classList.remove(`visible`);let t=e.dataTransfer?.files;if(t&&t.length>0){let e=t[0];e.type.startsWith(`image/`)?this.callbacks.onDropFile?.(e):this.notifyNotice(`请拖入有效的地学图谱图片文件 (PNG/JPG/WebP)`)}})}initClipboardPaste(){window.addEventListener(`paste`,e=>{let t=e.target?.tagName;if(t===`INPUT`||t===`TEXTAREA`)return;let n=e.clipboardData?.items;if(n){for(let e=0;e<n.length;e++)if(n[e].type.startsWith(`image/`)){let t=n[e].getAsFile();if(t){this.callbacks.onDropFile?.(t),this.notifyNotice(`已从剪贴板粘贴载入地质图谱图片`);break}}}})}notifyNotice(e){this.callbacks.onStatusNotice&&this.callbacks.onStatusNotice(e)}getCanvasPoint(e){let t=this.canvas.getBoundingClientRect();return{x:e.clientX-t.left,y:e.clientY-t.top}}onKeyDown(e){let t=e.target?.tagName;if(t!==`INPUT`&&t!==`TEXTAREA`&&t!==`SELECT`){if(!e.ctrlKey&&!e.metaKey&&!e.altKey){if(e.code===`KeyV`){e.preventDefault(),this.setToolMode(`select`),this.notifyNotice(`切换工具: 选择与微调模式 (V)`);return}if(e.code===`KeyH`){e.preventDefault(),this.setToolMode(`pan`),this.notifyNotice(`切换工具: 抓手平移模式 (H)`);return}if(e.code===`KeyR`){e.preventDefault(),this.setToolMode(`roi`),this.notifyNotice(`切换工具: 数据有效区 ROI 模式 (R)`);return}if(e.code===`KeyC`){e.preventDefault(),this.setToolMode(`addCol`),this.notifyNotice(`切换工具: 添加分列线 (C) - 点击图表插入垂直基线`);return}if(e.code===`KeyP`){e.preventDefault(),this.setToolMode(`addPoint`),this.notifyNotice(`切换工具: 添加控制拐点 (P) - 点击向当前属种插入锚点`);return}if(e.code===`KeyE`){e.preventDefault(),this.setToolMode(`eraser`),this.notifyNotice(`切换工具: 橡皮擦删除工具 (E) - 点击锚点或分列线删除`);return}}if(e.code===`Space`&&!this.isSpaceDown){this.isSpaceDown=!0,this.updateCursor(),e.preventDefault();return}if(e.code===`KeyB`){e.preventDefault();let t=this.viewport.toggleBinaryOverlay();this.notifyNotice(t?`透视遮罩: 二值化墨迹高亮模式 [已开启] (按 B 键关闭)`:`透视遮罩: 二值化墨迹高亮模式 [已关闭] (按 B 键开启)`),this.callbacks.onFilterChange?.(this.viewport.imageMode,this.viewport.showBinaryOverlay),this.requestRender();return}if(e.code===`KeyI`&&!e.ctrlKey&&!e.metaKey){e.preventDefault(),this.viewport.imageMode=this.viewport.imageMode===`invert`?`normal`:`invert`,this.notifyNotice(`底图滤镜: ${this.viewport.imageMode===`invert`?`反相负片 (Invert)`:`原图 (Normal)`}`),this.callbacks.onFilterChange?.(this.viewport.imageMode,this.viewport.showBinaryOverlay),this.requestRender();return}if(e.code===`KeyC`&&!e.ctrlKey&&!e.metaKey){e.preventDefault(),this.viewport.imageMode=this.viewport.imageMode===`contrast`?`normal`:`contrast`,this.notifyNotice(`底图滤镜: ${this.viewport.imageMode===`contrast`?`高对比度 (Contrast)`:`原图 (Normal)`}`),this.callbacks.onFilterChange?.(this.viewport.imageMode,this.viewport.showBinaryOverlay),this.requestRender();return}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()===`z`&&!e.shiftKey){e.preventDefault();let t=this.history.undo();t&&(this.data.columns=t.columns,this.data.activeTaxaId=t.activeTaxaId,this.requestRender())}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()===`y`||(e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()===`z`){e.preventDefault();let t=this.history.redo();t&&(this.data.columns=t.columns,this.data.activeTaxaId=t.activeTaxaId,this.requestRender())}}}onKeyUp(e){e.code===`Space`&&(this.isSpaceDown=!1,this.isPanning=!1,this.updateCursor())}onWheel(e){e.preventDefault();let t=this.getCanvasPoint(e),n=e.deltaY<0;this.viewport.zoomStepAt(t,n,e.ctrlKey||e.metaKey),this.requestRender()}onMouseDown(e){let t=this.getCanvasPoint(e);this.lastMouseScreen=t,this.isMouseDown=!0,this.hasDraggedAnchor=!1;let n=this.toolModeManager.getMode();if(e.button===1||e.button===0&&(this.isSpaceDown||n===`pan`)){this.isPanning=!0,this.updateCursor();return}if(e.button===0){let e=this.viewport.screenToWorld(t),r=this.data.calibration;if(n===`eraser`){let e=this.findHitAnchor(t);if(e){let t=this.data.columns.find(t=>t.id===e.taxaId);if(t){let n=t.controlPoints.find(t=>t.id===e.pointId);if(n){let e=new u(t.id,n,t.name);this.history.push(`Delete Anchor from ${t.name}`,this.data.columns,this.data.activeTaxaId),e.execute(this.data),this.hoveredAnchor=null,this.notifyNotice(`已删除 ${t.name} 在深度层位 Y:${n.y} 处的拐点`),this.requestRender(),this.callbacks.onDataChange?.()}}return}let n=this.findHitBoundary(t);if(n){let e=this.data.columns.findIndex(e=>e.id===n.taxaId);if(e!==-1&&this.data.columns.length>1){let t=this.data.columns.splice(e,1)[0];this.history.push(`Delete Column ${t.name}`,this.data.columns,this.data.activeTaxaId),this.notifyNotice(`已删除属种列: ${t.name}`),this.hoveredBoundary=null,this.requestRender(),this.callbacks.onDataChange?.()}return}return}if(n===`addCol`){let t=Math.round(e.x),n={id:`taxa_${Date.now()}`,name:`Taxa ${this.data.columns.length+1}`,color:`#38bdf8`,startX:t,endX:t+80,tickEndX:t+80,maxPercent:50,unit:`%`,curveType:`linear`,visible:!0,isLocked:!0,controlPoints:[{id:`pt_${Date.now()}_top`,x:t+5,y:r.dataYMin,type:`manual`,createdAt:Date.now()},{id:`pt_${Date.now()}_bot`,x:t+5,y:r.dataYMax,type:`manual`,createdAt:Date.now()+1}]};this.data.columns.push(n),this.data.columns.sort((e,t)=>e.startX-t.startX),this.data.activeTaxaId=n.id,this.history.push(`Add Column ${n.name}`,this.data.columns,this.data.activeTaxaId),this.notifyNotice(`已在 X:${t}px 处插入新属种分列！`),this.setToolMode(`select`),this.requestRender(),this.callbacks.onDataChange?.(),this.callbacks.onTaxaChange?.(n.id);return}let i=this.findHitRoiHandle(t);if((i||n===`roi`)&&i){this.draggingRoiHandle=i,this.dragInitialCalibration={...this.data.calibration},this.updateCursor();return}let a=this.findHitColumn(e),o=this.findHitAnchor(t);if(o){this.draggingAnchor=o,this.data.activeTaxaId=o.taxaId,this.data.selectedEntity={type:`point`,colId:o.taxaId,pointId:o.pointId};let e=this.data.columns.find(e=>e.id===o.taxaId)?.controlPoints.find(e=>e.id===o.pointId);e&&(this.dragInitialPointPos={x:e.x,y:e.y}),this.callbacks.onTaxaChange&&this.callbacks.onTaxaChange(o.taxaId),this.updateCursor(),this.requestRender();return}let s=this.findHitBoundary(t);if(s){this.draggingBoundary={taxaId:s.taxaId,type:s.type},this.data.activeTaxaId=s.taxaId,this.data.selectedEntity={type:`column`,id:s.taxaId,part:s.type};let e=this.data.columns.find(e=>e.id===s.taxaId);e&&(this.dragInitialColumn={startX:e.startX,endX:e.endX,tickEndX:e.tickEndX??e.endX}),this.callbacks.onTaxaChange&&this.callbacks.onTaxaChange(s.taxaId),this.updateCursor();return}if(a&&a.id!==this.data.activeTaxaId){this.data.activeTaxaId=a.id,this.data.selectedEntity={type:`column`,id:a.id},this.notifyNotice(`已选中属种列: ${a.name} (可直接在图上拉点修改)`),this.callbacks.onTaxaChange&&this.callbacks.onTaxaChange(a.id),this.requestRender();return}if(n===`addPoint`||n===`select`&&this.isWithinDiagramBounds(e)){let t=this.getActiveColumn();if(t&&this.isWithinDiagramBounds(e)){let n=Math.round(e.y);if(this.hoveredDepthHorizon!==null){let t=(this.hoveredDepthHorizon-r.depthTopValue)/(r.depthBottomValue-r.depthTopValue||1),i=Math.round(r.dataYMin+t*(r.dataYMax-r.dataYMin));Math.abs(e.y-i)<=10/this.viewport.scale&&(n=i)}let i={id:`pt_${Date.now()}_${Math.random().toString(36).substring(2,6)}`,x:Math.round(e.x),y:n,type:`manual`,isManual:!0,createdAt:Date.now()},a=new l(t.id,i,t.name);this.history.push(`Add Anchor to ${t.name}`,this.data.columns,this.data.activeTaxaId),a.execute(this.data),this.dragInitialPointPos={x:i.x,y:i.y},this.draggingAnchor={taxaId:t.id,pointId:i.id},this.data.selectedEntity={type:`point`,colId:t.id,pointId:i.id},this.requestRender(),this.callbacks.onDataChange?.();return}}this.hoveredAnchor=null,this.hoveredBoundary=null,this.hoveredRoiHandle=null,this.data.selectedEntity=null,this.updateCursor(),this.requestRender(),this.callbacks.onDataChange?.()}}onMouseMove(e){let t=this.getCanvasPoint(e),n=t.x-this.lastMouseScreen.x,r=t.y-this.lastMouseScreen.y;this.lastMouseScreen=t;let i=this.viewport.screenToWorld(t),a=this.data.calibration,s=a.dataYMax-a.dataYMin,c=a.depthInterval&&a.depthInterval>0?a.depthInterval:2,l;if(s>0){if(l=a.depthTopValue+(i.y-a.dataYMin)/s*(a.depthBottomValue-a.depthTopValue),i.y>=a.dataYMin-15&&i.y<=a.dataYMax+15){let e=Math.round(l/c)*c,t=a.dataYMin+(e-a.depthTopValue)/(a.depthBottomValue-a.depthTopValue||1)*s;this.hoveredDepthHorizon=Math.abs(i.y-t)<=8/this.viewport.scale?Number(e.toFixed(2)):null}else this.hoveredDepthHorizon=null}let u=Math.max(0,a.dataXMin-50),d=this.isHoveringDepthRulerBadge;if(this.isHoveringDepthRulerBadge=i.x<=u&&i.x>=u-160&&i.y>=a.dataYMin-35&&i.y<=a.dataYMin+5,d!==this.isHoveringDepthRulerBadge&&(this.updateCursor(),this.requestRender()),this.callbacks.onHoverInfo){let e=this.getActiveColumn(),t;e&&(t=o.imageXToPercent(i.x,e)),this.callbacks.onHoverInfo({worldX:Math.round(i.x),worldY:Math.round(i.y),depth:l?Number(l.toFixed(2)):void 0,percent:t?Number(Math.max(0,t).toFixed(1)):void 0,horizonDepth:this.hoveredDepthHorizon})}if(this.draggingRoiHandle){let e=this.draggingRoiHandle,t=this.data.calibration,n=Math.round(i.x),r=Math.round(i.y);e.includes(`l`)&&(t.dataXMin=Math.min(n,t.dataXMax-20)),e.includes(`r`)&&(t.dataXMax=Math.max(n,t.dataXMin+20)),e.includes(`t`)&&(t.dataYMin=Math.min(r,t.dataYMax-20)),e.includes(`b`)&&(t.dataYMax=Math.max(r,t.dataYMin+20)),this.requestRender();return}if(this.isPanning){this.viewport.panBy(n,r),this.requestRender();return}if(this.draggingAnchor){this.hasDraggedAnchor=!0;let e=this.data.columns.find(e=>e.id===this.draggingAnchor.taxaId);if(e){let t=e.controlPoints.find(e=>e.id===this.draggingAnchor.pointId);t&&(t.x=Math.round(i.x),t.y=Math.round(i.y),t.isManual=!0,e.controlPoints.sort((e,t)=>e.y-t.y),this.requestRender())}return}if(this.draggingBoundary){let{taxaId:e,type:t}=this.draggingBoundary,n=this.data.columns.findIndex(t=>t.id===e);if(n!==-1){let e=this.data.columns[n],r=Math.round(i.x);if(t===`start`)e.startX=r,e.scaleCalib&&(e.scaleCalib.originX=r),n>0&&(this.data.columns[n-1].endX=r);else if(t===`tick`)e.tickEndX=r,e.scaleCalib&&(e.scaleCalib.calibX=r);else if(e.endX=r,n<this.data.columns.length-1){let e=this.data.columns[n+1];e&&(e.startX=r,e.scaleCalib&&(e.scaleCalib.originX=r))}this.requestRender()}return}let f=this.hoveredAnchor,p=this.hoveredBoundary;this.hoveredAnchor=this.findHitAnchor(t),this.hoveredBoundary=this.hoveredAnchor?null:this.findHitBoundary(t),(f?.pointId!==this.hoveredAnchor?.pointId||p?.taxaId!==this.hoveredBoundary?.taxaId||p?.type!==this.hoveredBoundary?.type)&&(this.updateCursor(),this.requestRender())}onMouseUp(e){if(this.draggingRoiHandle&&this.dragInitialCalibration){let e=this.data.calibration;this.history.push(`Resize Data ROI`,this.data.columns,this.data.activeTaxaId,this.data.calibration),this.notifyNotice(`地质数据区已调整为: [${e.dataXMin}, ${e.dataXMax}] x [${e.dataYMin}, ${e.dataYMax}]`),this.callbacks.onDataChange?.()}else if(this.draggingAnchor&&this.hasDraggedAnchor&&this.dragInitialPointPos){let e=this.data.columns.find(e=>e.id===this.draggingAnchor.taxaId),t=e?.controlPoints.find(e=>e.id===this.draggingAnchor.pointId);e&&t&&(this.history.push(`Move Anchor in ${e.name}`,this.data.columns,this.data.activeTaxaId),this.callbacks.onDataChange?.())}else if(this.draggingBoundary&&this.dragInitialColumn){let e=this.data.columns.find(e=>e.id===this.draggingBoundary.taxaId);e&&(this.history.push(`Adjust Column Boundary ${e.name}`,this.data.columns,this.data.activeTaxaId),this.callbacks.onDataChange?.())}this.isMouseDown=!1,this.isPanning=!1,this.draggingAnchor=null,this.draggingBoundary=null,this.draggingRoiHandle=null,this.dragInitialPointPos=null,this.dragInitialColumn=null,this.dragInitialCalibration=null,this.hasDraggedAnchor=!1,this.updateCursor(),this.requestRender()}onContextMenu(e){e.preventDefault();let t=this.getCanvasPoint(e),n=this.findHitAnchor(t);if(n){let e=this.data.columns.find(e=>e.id===n.taxaId);if(e){let t=e.controlPoints.length;e.controlPoints=e.controlPoints.filter(e=>e.id!==n.pointId),e.controlPoints.length<t&&(this.history.push(`Remove Anchor from ${e.name}`,this.data.columns,this.data.activeTaxaId),this.hoveredAnchor=null,this.updateCursor(),this.requestRender())}}}updateCursor(){if(this.isPanning||this.isSpaceDown||this.toolModeManager.getMode()===`pan`)this.canvas.style.cursor=this.isMouseDown?`grabbing`:`grab`;else if(this.draggingRoiHandle||this.hoveredRoiHandle){let e=this.draggingRoiHandle||this.hoveredRoiHandle;e===`tl`||e===`br`?this.canvas.style.cursor=`nwse-resize`:e===`tr`||e===`bl`?this.canvas.style.cursor=`nesw-resize`:e===`t`||e===`b`?this.canvas.style.cursor=`ns-resize`:(e===`l`||e===`r`)&&(this.canvas.style.cursor=`ew-resize`)}else if(this.draggingAnchor||this.hoveredAnchor)this.canvas.style.cursor=`move`;else if(this.draggingBoundary||this.hoveredBoundary)this.canvas.style.cursor=`col-resize`;else{let e=this.toolModeManager.getMode();this.canvas.style.cursor=this.toolModeManager.getToolDescription(e).cursor}}findHitColumn(e){let t=this.data.calibration;if(e.y<t.dataYMin-60||e.y>t.dataYMax+40)return null;for(let t of this.data.columns)if(t.visible&&e.x>=t.startX-3&&e.x<=t.endX+3)return t;return null}isWithinDiagramBounds(e){let t=this.data.calibration;return e.y>=t.dataYMin-50&&e.y<=t.dataYMax+50}findHitAnchor(e){let t=this.ANCHOR_HIT_RADIUS_SCREEN,n=this.getActiveColumn();if(n&&n.visible)for(let r of n.controlPoints){let i=this.viewport.worldToScreen(r);if(Math.hypot(i.x-e.x,i.y-e.y)<=t)return{taxaId:n.id,pointId:r.id}}for(let n of this.data.columns)if(n.id!==this.data.activeTaxaId&&n.visible)for(let r of n.controlPoints){let i=this.viewport.worldToScreen(r);if(Math.hypot(i.x-e.x,i.y-e.y)<=t)return{taxaId:n.id,pointId:r.id}}return null}findHitBoundary(e){let t=this.BOUNDARY_HIT_WIDTH_SCREEN;for(let n of this.data.columns){if(!n.visible)continue;let r=this.viewport.worldToScreen({x:n.startX,y:0}).x;if(Math.abs(e.x-r)<=t)return{taxaId:n.id,type:`start`,x:n.startX};let i=n.tickEndX&&n.tickEndX>n.startX?n.tickEndX:n.endX,a=this.viewport.worldToScreen({x:i,y:0}).x;if(Math.abs(e.x-a)<=t)return{taxaId:n.id,type:`tick`,x:i};if(n.endX>i+2){let r=this.viewport.worldToScreen({x:n.endX,y:0}).x;if(Math.abs(e.x-r)<=t)return{taxaId:n.id,type:`end`,x:n.endX}}}return null}findHitRoiHandle(e){let t=this.data.calibration,n=this.viewport.worldToScreen({x:t.dataXMin,y:t.dataYMin}),r=this.viewport.worldToScreen({x:t.dataXMax,y:t.dataYMax}),i=(n.x+r.x)/2,a=(n.y+r.y)/2,o={tl:{x:n.x,y:n.y},tr:{x:r.x,y:n.y},bl:{x:n.x,y:r.y},br:{x:r.x,y:r.y},t:{x:i,y:n.y},b:{x:i,y:r.y},l:{x:n.x,y:a},r:{x:r.x,y:a}},s=this.ROI_HANDLE_SIZE_SCREEN+2;for(let[t,n]of Object.entries(o))if(Math.hypot(e.x-n.x,e.y-n.y)<=s)return t;return null}render(){let e=this.ctx,t=this.canvas.getBoundingClientRect(),n=this.viewport.dpr,r=document.body.classList.contains(`theme-light`);e.save(),e.setTransform(n,0,0,n,0,0),e.fillStyle=r?`#f8fafc`:`#0b0f19`,e.fillRect(0,0,t.width,t.height),this.drawGrid(e,t.width,t.height,r),this.viewport.applyTransform(e),this.drawBackgroundDiagram(e,r),this.workflowStage>=4&&this.drawDepthGrid(e,r),this.workflowStage>=1&&this.drawCalibrationOverlay(e,r),this.workflowStage>=3&&this.data.columns.length>0&&this.drawColumnBoundaries(e,r),this.workflowStage>=5&&this.data.columns.length>0&&(this.drawPollenCurves(e),this.drawAnchors(e),this.drawGhostingOverlay(e)),e.restore(),this.minimap&&this.minimap.updateViewport(this.viewport,t.width,t.height)}drawGrid(e,t,n,r){e.save(),e.strokeStyle=r?`rgba(0, 0, 0, 0.05)`:`rgba(255, 255, 255, 0.035)`,e.lineWidth=1,e.beginPath();for(let r=0;r<t;r+=40)e.moveTo(r,0),e.lineTo(r,n);for(let r=0;r<n;r+=40)e.moveTo(0,r),e.lineTo(t,r);e.stroke(),e.restore()}drawBackgroundDiagram(e,t){if(this.diagramImage&&this.isImageLoaded){let n=this.viewport.imageMode,r=this.diagramImage.naturalWidth,i=this.diagramImage.naturalHeight;if(t&&(e.save(),e.shadowColor=`rgba(0, 0, 0, 0.15)`,e.shadowBlur=16/this.viewport.scale,e.shadowOffsetX=0,e.shadowOffsetY=4/this.viewport.scale,e.fillStyle=`#ffffff`,e.fillRect(0,0,r,i),e.restore()),e.save(),e.imageSmoothingEnabled=!0,e.imageSmoothingQuality=`high`,n===`binary`&&this.binaryMonoCanvas)e.drawImage(this.binaryMonoCanvas,0,0,r,i);else{n===`invert`?e.filter=`invert(1) hue-rotate(180deg) brightness(105%) contrast(120%)`:n===`contrast`&&(e.filter=`contrast(240%) brightness(105%)`);let t=this.canvas.getBoundingClientRect(),a=this.viewport.screenToWorld({x:0,y:0}),o=this.viewport.screenToWorld({x:t.width,y:t.height}),s=Math.max(0,Math.floor(a.x)),c=Math.max(0,Math.floor(a.y)),l=Math.min(r-s,Math.ceil(o.x-a.x)+2),u=Math.min(i-c,Math.ceil(o.y-a.y)+2);l>0&&u>0&&s<r&&c<i?e.drawImage(this.diagramImage,s,c,l,u,s,c,l,u):e.drawImage(this.diagramImage,0,0),e.filter=`none`}e.restore(),this.viewport.showBinaryOverlay&&this.binaryMaskCanvas&&(e.save(),e.globalAlpha=.85,e.drawImage(this.binaryMaskCanvas,0,0,r,i),e.restore())}else e.save(),e.fillStyle=t?`#f8fafc`:`#1e293b`,e.fillRect(0,0,this.data.imageWidth||1600,this.data.imageHeight||1e3),e.fillStyle=t?`#64748b`:`#94a3b8`,e.font=`24px sans-serif`,e.fillText(`正在载入地质图谱...`,400,400),e.restore()}drawDepthGrid(e,n){let r=this.data.calibration;if(r.depthGridEnabled===!1)return;let i=r.depthInterval&&r.depthInterval>0?r.depthInterval:2,{depths:a,yPositions:o}=t.getStandardDepthHorizons(r);if(a.length===0)return;let s=this.viewport.scale,c=this.data.columns,l=Math.max(0,r.dataXMin-50),u=c.length>0?Math.max(r.dataXMax,c[c.length-1].endX+30):r.dataXMax+60;e.save();let d=a.length>60?Math.ceil(a.length/30):1;for(let t=0;t<a.length;t++){let r=a[t],c=o[t],f=t%5==0,p=this.hoveredDepthHorizon!==null&&Math.abs(this.hoveredDepthHorizon-r)<=i*.45;e.beginPath(),e.moveTo(l,c),e.lineTo(u,c),p?(e.strokeStyle=n?`#0284c7`:`#38bdf8`,e.lineWidth=2.2/s,e.setLineDash([])):f?(e.strokeStyle=n?`rgba(2, 132, 199, 0.45)`:`rgba(56, 189, 248, 0.45)`,e.lineWidth=1.3/s,e.setLineDash([5/s,4/s])):(e.strokeStyle=n?`rgba(100, 116, 139, 0.25)`:`rgba(125, 211, 252, 0.22)`,e.lineWidth=.85/s,e.setLineDash([2.5/s,3.5/s])),e.stroke(),(t%d===0||p)&&(e.fillStyle=p?n?`#0284c7`:`#38bdf8`:f?n?`#0369a1`:`#7dd3fc`:n?`#64748b`:`rgba(125, 211, 252, 0.7)`,e.font=`${f||p?`bold `:``}${Math.max(9,11/s)}px 'JetBrains Mono', monospace`,e.textAlign=`right`,e.textBaseline=`middle`,e.fillText(`${r}`,l-8,c))}e.beginPath(),e.moveTo(l-4,r.dataYMin),e.lineTo(l-4,r.dataYMax),e.strokeStyle=n?`rgba(2, 132, 199, 0.7)`:`rgba(56, 189, 248, 0.6)`,e.lineWidth=1.5/s,e.setLineDash([]),e.stroke();let f=l-8,p=r.dataYMin-16;e.font=`bold ${Math.max(10,11.5/s)}px 'JetBrains Mono', monospace`,e.textAlign=`right`,e.textBaseline=`middle`,this.isHoveringDepthRulerBadge?(e.fillStyle=n?`#0284c7`:`#38bdf8`,e.fillText(`⚙ 标尺: ${i}${r.unit} [点击修改]`,f,p)):(e.fillStyle=n?`rgba(2, 132, 199, 0.9)`:`rgba(56, 189, 248, 0.85)`,e.fillText(`Depth (${r.unit}) [Δ=${i}]`,f,p)),e.restore()}drawCalibrationOverlay(e,t){let n=this.data.calibration,r=this.viewport.scale,i=this.toolModeManager.getMode()===`roi`;e.save();let a=n.dataXMax-n.dataXMin,o=n.dataYMax-n.dataYMin;e.fillStyle=t?i?`rgba(2, 132, 199, 0.08)`:`rgba(2, 132, 199, 0.03)`:i?`rgba(56, 189, 248, 0.08)`:`rgba(56, 189, 248, 0.03)`,e.fillRect(n.dataXMin,n.dataYMin,a,o),e.strokeStyle=t?i?`#0284c7`:`rgba(2, 132, 199, 0.7)`:i?`#38bdf8`:`rgba(56, 189, 248, 0.7)`,e.lineWidth=(i?2.2:1.5)/r,e.setLineDash(i?[]:[6/r,4/r]),e.strokeRect(n.dataXMin,n.dataYMin,a,o);let s=this.ROI_HANDLE_SIZE_SCREEN/r,c=(n.dataXMin+n.dataXMax)/2,l=(n.dataYMin+n.dataYMax)/2,u={tl:{x:n.dataXMin,y:n.dataYMin},tr:{x:n.dataXMax,y:n.dataYMin},bl:{x:n.dataXMin,y:n.dataYMax},br:{x:n.dataXMax,y:n.dataYMax},t:{x:c,y:n.dataYMin},b:{x:c,y:n.dataYMax},l:{x:n.dataXMin,y:l},r:{x:n.dataXMax,y:l}};e.setLineDash([]);for(let[n,i]of Object.entries(u)){let a=this.hoveredRoiHandle===n||this.draggingRoiHandle===n,o=a?s*1.3:s;e.fillStyle=a?`#f97316`:`#ffffff`,e.strokeStyle=t?`#0f172a`:`#0b0f19`,e.lineWidth=1.5/r,e.fillRect(i.x-o/2,i.y-o/2,o,o),e.strokeRect(i.x-o/2,i.y-o/2,o,o)}e.fillStyle=t?`#0284c7`:`#7dd3fc`,e.font=`bold ${Math.max(10,11/r)}px 'JetBrains Mono', monospace`,e.textAlign=`right`,e.fillText(`Top: ${n.depthTopValue} ${n.unit} ─┐`,n.dataXMin-8/r,n.dataYMin+4/r),e.fillText(`Bottom: ${n.depthBottomValue} ${n.unit} ─┘`,n.dataXMin-8/r,n.dataYMax+4/r),e.restore()}drawColumnBoundaries(e,t){let n=this.data.calibration,r=n.dataYMin-40,i=n.dataYMax+30,a=this.viewport.scale;e.save(),this.data.columns.forEach(n=>{if(!n.visible)return;let o=n.id===this.data.activeTaxaId,s=n.scaleCalib||{originX:n.startX,originVal:0,calibX:n.tickEndX&&n.tickEndX>n.startX?n.tickEndX:n.endX,calibVal:n.maxPercent??20,unit:n.unit||`%`},c=this.hoveredBoundary?.taxaId===n.id&&this.hoveredBoundary.type===`start`||this.draggingBoundary?.taxaId===n.id&&this.draggingBoundary.type===`start`,l=this.hoveredBoundary?.taxaId===n.id&&this.hoveredBoundary.type===`tick`||this.draggingBoundary?.taxaId===n.id&&this.draggingBoundary.type===`tick`,u=this.hoveredBoundary?.taxaId===n.id&&this.hoveredBoundary.type===`end`||this.draggingBoundary?.taxaId===n.id&&this.draggingBoundary.type===`end`;if(e.beginPath(),e.moveTo(s.originX,r),e.lineTo(s.originX,i),c?(e.strokeStyle=`#f97316`,e.lineWidth=3/a,e.setLineDash([])):(e.strokeStyle=t?`rgba(2, 132, 199, 0.9)`:`rgba(56, 189, 248, 0.85)`,e.lineWidth=(o?2:1.5)/a,e.setLineDash([])),e.stroke(),e.beginPath(),e.moveTo(s.calibX,r),e.lineTo(s.calibX,i),l?(e.strokeStyle=`#f97316`,e.lineWidth=3/a,e.setLineDash([])):(e.strokeStyle=t?`rgba(220, 38, 38, 0.85)`:`rgba(239, 68, 68, 0.8)`,e.lineWidth=1.6/a,e.setLineDash([5/a,3/a])),e.stroke(),n.endX>s.calibX+4&&(e.beginPath(),e.moveTo(n.endX,r),e.lineTo(n.endX,i),u?(e.strokeStyle=`#f97316`,e.lineWidth=2.5/a,e.setLineDash([])):(e.strokeStyle=t?`rgba(148, 163, 184, 0.5)`:`rgba(148, 163, 184, 0.35)`,e.lineWidth=1/a,e.setLineDash([2/a,4/a])),e.stroke()),o){let t=6/a;e.fillStyle=`#38bdf8`,e.fillRect(s.originX-t/2,r-t/2,t,t),e.fillStyle=l?`#fbbf24`:`#f97316`,e.beginPath(),e.moveTo(s.calibX,r-t),e.lineTo(s.calibX+t,r),e.lineTo(s.calibX,r+t),e.lineTo(s.calibX-t,r),e.closePath(),e.fill(),e.strokeStyle=`#ffffff`,e.lineWidth=1/a,e.stroke()}let d=n.endX-n.startX,f=n.startX+d/2,p=n.endX-n.startX;if(o){e.save(),e.font=`bold ${Math.max(10,12/a)}px sans-serif`;let i=e.measureText(n.name).width+16/a,o=20/a;e.fillStyle=t?`#0284c7`:`#38bdf8`;let c=f-i/2,l=r-26/a;e.beginPath(),typeof e.roundRect==`function`?e.roundRect(c,l,i,o,4/a):e.rect(c,l,i,o),e.fill(),e.fillStyle=`#ffffff`,e.textAlign=`center`,e.textBaseline=`middle`,e.fillText(n.name,f,r-16/a),e.restore(),e.font=`600 ${Math.max(8.5,9.5/a)}px sans-serif`,e.fillStyle=t?`#0284c7`:`#38bdf8`,e.textAlign=`left`,e.fillText(`${s.originVal}${s.unit||`%`}`,s.originX+2/a,r-2/a),e.fillStyle=t?`#dc2626`:`#f87171`,e.textAlign=`right`,e.fillText(`${s.calibVal}${s.unit||`%`}`,s.calibX-2/a,r-2/a)}else{if(e.save(),e.fillStyle=t?`#475569`:`rgba(255, 255, 255, 0.75)`,e.font=`500 ${Math.max(9,10.5/a)}px sans-serif`,p<42&&a<1){e.translate(f,r-6/a),e.rotate(-Math.PI/4),e.textAlign=`left`,e.textBaseline=`middle`;let t=n.name.length>12?n.name.substring(0,10)+`…`:n.name;e.fillText(t,0,0)}else{e.textAlign=`center`,e.textBaseline=`bottom`;let t=n.name.length>12?n.name.substring(0,10)+`…`:n.name;e.fillText(t,f,r-4/a)}e.restore()}}),e.restore()}drawPollenCurves(e){e.save();let n=this.viewport.scale;this.data.columns.forEach(r=>{if(!r.visible||r.controlPoints.length===0)return;let i=r.id===this.data.activeTaxaId,a=[...r.controlPoints].sort((e,t)=>e.y-t.y),o=r.plotType||`area`;if(o===`bar`){e.fillStyle=r.color,e.strokeStyle=r.color;let t=Math.max(1.5,3/n);a.forEach(n=>{let i=Math.max(0,n.x-r.startX);e.fillRect(r.startX,n.y-t/2,i,t)})}else if(o===`symbol`){e.strokeStyle=r.color,e.lineWidth=1.5/n;let t=4/n;a.forEach(n=>{n.x>r.startX+.5&&(e.beginPath(),e.arc(n.x,n.y,t,0,Math.PI*2),e.fillStyle=i?r.color:`${r.color}88`,e.fill(),e.stroke())})}else{if(o===`area`){let n=t.buildAreaPath(a,r.startX,r.curveType);e.fillStyle=i?`${r.color}44`:`${r.color}1a`,e.fill(n)}let s=t.buildPath(a,r.curveType);e.strokeStyle=r.color,e.lineWidth=(i?2.5:1.4)/n,e.setLineDash([]),e.stroke(s)}}),e.restore()}drawAnchors(e){let t=this.viewport.scale,n=this.getActiveColumn();n&&n.visible&&(e.save(),n.controlPoints.forEach(r=>{let i=this.hoveredAnchor?.pointId===r.id,a=this.draggingAnchor?.pointId===r.id,o=r.type===`peak`||r.type===`trough`?6:r.type===`manual`||r.isManual?5.5:4,s=(a?o*1.35:i?o*1.25:o)/t;(i||a)&&(e.beginPath(),e.arc(r.x,r.y,s+3.5/t,0,Math.PI*2),e.fillStyle=a?`rgba(249, 115, 22, 0.4)`:`rgba(56, 189, 248, 0.35)`,e.fill()),e.beginPath(),e.arc(r.x,r.y,s,0,Math.PI*2),r.type===`peak`?(e.fillStyle=a?`#f97316`:`#fbbf24`,e.fill(),e.strokeStyle=`#111827`,e.lineWidth=1.8/t,e.stroke()):r.type===`trough`?(e.fillStyle=a?`#f97316`:`#f59e0b`,e.fill(),e.strokeStyle=`#111827`,e.lineWidth=1.8/t,e.stroke()):r.type===`manual`||r.isManual?(e.fillStyle=a?`#f97316`:`#38bdf8`,e.fill(),e.strokeStyle=`#ffffff`,e.lineWidth=1.8/t,e.stroke()):(e.fillStyle=`rgba(17, 24, 39, 0.75)`,e.fill(),e.strokeStyle=n.color||`#ffffff`,e.lineWidth=1.6/t,e.stroke())}),e.restore())}setWorkflowStage(e){this.workflowStage=e,this.updateEmptyStateVisibility(),this.requestRender()}drawGhostingOverlay(e){if(!this.viewport.showGhosting)return;let n=this.viewport.scale;e.save(),this.data.columns.forEach(r=>{if(!r.visible||r.controlPoints.length===0)return;let i=[...r.controlPoints].sort((e,t)=>e.y-t.y);if((r.plotType||`area`)===`area`){let a=t.buildAreaPath(i,r.startX,r.curveType);e.fillStyle=s.color.ghost.overlayFill,e.fill(a);let o=t.buildPath(i,r.curveType);e.strokeStyle=s.color.ghost.overlayStroke,e.lineWidth=1.6/n,e.setLineDash([4/n,3/n]),e.stroke(o)}}),e.restore()}setDegridStrength(e){this.viewport.degridStrength=e,this.generateBinaryCache(),this.render()}},p={0:{stage:0,title:`S0：空状态 (Empty State)`,stepName:`空状态`,guideText:`请点击顶栏 [📁 图谱] 或拖拽地质剖面图至画布中央开始工作。`,primaryActionLabel:`📁 加载图片`},1:{stage:1,title:`S1：图片已加载 (Image Loaded)`,stepName:`1.加载`,guideText:`图片已居中自适应展示。请在画布上拖拽框选纯数据有效区 (ROI)，排除外围坐标轴与文字。`,primaryActionLabel:`👉 确认 ROI 并进入清理 (S2)`},2:{stage:2,title:`S2：ROI 已确认与图像清理 (ROI Confirmed & Clean)`,stepName:`2.ROI`,guideText:`数据有效区已锁定。可开启去横线滤镜与按 B 键红色高亮预览，确认后进入分列。`,primaryActionLabel:`👉 确认有效区，开始分列 (S3)`},3:{stage:3,title:`S3：分列与属种名单对齐 (Column Partitioning)`,stepName:`3.分列`,guideText:`请在侧边栏批量导入/粘贴属种名单，使用 ▲/▼ 顺位对调或 ➕插空列 保证名单与图谱 100% 严密对齐。`,primaryActionLabel:`👉 确认列对齐，进入标尺标定 (S4)`},4:{stage:4,title:`S4：标尺标定 (Calibration)`,stepName:`4.标尺`,guideText:`请在右侧检查器完成两点式深度标定与各属种列物理刻度齿标定（支持 Linear/Log 硬约束）。`,primaryActionLabel:`👉 确认标尺，开始提取拐点 (S5)`},5:{stage:5,title:`S5：拐点提取与多边形精修 (Digitize & Refine)`,stepName:`5.拐点`,guideText:`已提取稀疏控制手柄与绿色半透明原位重绘层 (Visual Ghosting)。左键拉拽、右键删点微调轮廓。`,primaryActionLabel:`👉 完成精修，进入地学校验 (S6)`},6:{stage:6,title:`S6：地学校验与自检门禁 (Verification & QA)`,stepName:`6.校验`,guideText:`已启动全剖面 100% 丰度总和自检门禁，可切换图层开关、打开双向冻结数据表检查各层位。`,primaryActionLabel:`👉 校验达标，进入导出交付 (S7)`},7:{stage:7,title:`S7：导出交付 (Export Deliverables)`,stepName:`7.导出`,guideText:`请选择导出格式 (CSV / Straditize .tar 开放归档 / rioja 自动绘图脚本) 保存到本地。`,primaryActionLabel:`💾 打开导出面板`}},m=[{step:1,label:`1.加载`,name:`加载`},{step:2,label:`2.ROI`,name:`ROI`},{step:3,label:`3.分列`,name:`分列`},{step:4,label:`4.标尺`,name:`标尺`},{step:5,label:`5.拐点`,name:`拐点`},{step:6,label:`6.校验`,name:`校验`},{step:7,label:`7.导出`,name:`导出`}],h=class{element;history;backendStatus;callbacks;currentScaleText=`100%`;currentImageMode=`normal`;isBinaryOverlayActive=!1;currentWorkflowStep=3;isDesktopMode=!1;constructor(e,t,n){this.history=e,this.backendStatus=t,this.callbacks=n,this.element=document.createElement(`header`),this.element.className=`app-toolbar`,this.render()}setSidebarActive(e){}setInspectorActive(e){}setDesktopMode(e){this.isDesktopMode=e,this.render()}getElement(){return this.element}getImageMode(){return this.currentImageMode}setWorkflowStep(e){this.currentWorkflowStep!==e&&(this.currentWorkflowStep=e,this.render())}setToolMode(e){}updateStatus(e){if(this.backendStatus=e,typeof e.isDesktopMode==`boolean`&&e.isDesktopMode!==this.isDesktopMode){this.isDesktopMode=e.isDesktopMode,this.render();return}let t=this.element.querySelector(`#rpc-status-pill`);if(t){t.className=`status-pill ${e.connected?`online`:`mock`}`;let n=t.querySelector(`.status-dot`),r=t.querySelector(`.status-text`);r&&(r.textContent=e.connected?`RPC: Online`:`Mock`),n&&e.connected&&(n.style.boxShadow=`0 0 8px #10b981`)}}updateScale(e){this.currentScaleText=`${Math.round(e*100)}%`;let t=this.element.querySelector(`#zoom-indicator`);t&&(t.textContent=this.currentScaleText)}updateFilterState(e,t){this.currentImageMode=e,this.isBinaryOverlayActive=t;let n=this.element.querySelector(`#btn-toggle-binary`);n&&(t||e===`binary`?n.classList.add(`active`):n.classList.remove(`active`));let r=this.element.querySelector(`#select-image-mode`);r&&(r.value=e)}updateHistoryState(){let e=this.element.querySelector(`#btn-undo`),t=this.element.querySelector(`#btn-redo`);e&&(e.disabled=!this.history.canUndo()),t&&(t.disabled=!this.history.canRedo())}render(){let e=this.backendStatus.connected,t=m.map((e,t)=>{let n=e.step<this.currentWorkflowStep,r=e.step===this.currentWorkflowStep,i=n?`✓`:r?`●`:`○`;return`
        ${t>0?`<span class="workflow-arrow">›</span>`:``}
        <button class="workflow-step-btn ${r?`active-step`:n?`completed-step`:`upcoming-step`}" data-step="${e.step}" title="步骤 ${e.step}: ${e.name}${n?` (已完成，点击可跳回)`:``}">
          <span class="step-num">${i}</span>
          <span>${e.label}</span>
        </button>
      `}).join(``);this.element.innerHTML=`
      <div class="toolbar-left">
        <div class="brand">
          <div class="brand-logo">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M3 3v18h18M7 16l4-8 4 6 5-10" />
            </svg>
          </div>
          <span class="brand-name">Straditize <span style="background: linear-gradient(135deg, #0284c7, #38bdf8); color: #fff; font-size: 9.5px; font-weight: 700; padding: 1px 4px; border-radius: 4px; margin-left: 2px; letter-spacing: 0.5px;">PRO</span></span>
        </div>

        <div class="divider"></div>

        <div class="btn-group file-actions-group">
          <button id="btn-open-file" class="tool-btn open-file-btn highlight" title="打开本地地质图谱图片">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
            </svg>
            <span>图谱</span>
          </button>
          <input type="file" id="file-input-image" accept="image/*" style="display: none;" />

          <button id="btn-save-project" class="tool-btn" title="保存完整地质数字化项目 (.tar 开放归档)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>存项目</span>
          </button>

          <button id="btn-open-project" class="tool-btn" title="打开已有项目包 (.tar / .json)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span>开项目</span>
          </button>
          <input type="file" id="file-input-project" accept=".tar,.json,.tar.gz" style="display: none;" />

          <select id="select-sample-diagram" class="sample-select" title="快速载入经典地学剖面范例" style="max-width: 80px; font-size: 11px;">
            <option value="" disabled selected>📂 范例...</option>
            <option value="hoya">Hoya</option>
            <option value="verification">验证图谱</option>
            <option value="beginner">沉积图谱</option>
          </select>
        </div>
      </div>

      <div class="toolbar-center">
        <!-- 7 步工作流导引 Stepper -->
        <div class="workflow-stepper">
          ${t}
        </div>
      </div>

      <div class="toolbar-right">
        <!-- 撤销/重做 -->
        <div class="btn-group">
          <button id="btn-undo" class="tool-btn" title="撤销 (Ctrl+Z)" ${this.history.canUndo()?``:`disabled`} style="padding: 3px 6px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
            </svg>
          </button>
          <button id="btn-redo" class="tool-btn" title="重做 (Ctrl+Y)" ${this.history.canRedo()?``:`disabled`} style="padding: 3px 6px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/>
            </svg>
          </button>
        </div>

        <!-- 缩放控制 (10% ~ 1000%) -->
        <div class="btn-group">
          <button id="btn-zoom-out" class="tool-btn" title="缩小 (快捷键: 滚轮向下)" style="padding: 3px 5px;">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
          <span id="zoom-indicator" class="zoom-badge" style="min-width: 32px; font-size: 10px; cursor: pointer; padding: 2px 4px;" title="点击重置 100% (Ctrl+1)">${this.currentScaleText}</span>
          <button id="btn-zoom-in" class="tool-btn" title="放大 (快捷键: 滚轮向上)" style="padding: 3px 5px;">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
        </div>

        <!-- 滤镜与二值透视 -->
        <div class="btn-group" style="display: flex; align-items: center; gap: 3px;">
          <button id="btn-toggle-binary" class="tool-btn ${this.isBinaryOverlayActive?`active`:``}" title="二值化墨迹透视遮罩 (快捷键: B)" style="padding: 3px 6px; font-size: 10.5px;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 3v18A9 9 0 0 0 12 3z" fill="currentColor"/>
            </svg>
            <span>透视</span>
          </button>
          <select id="select-degrid-strength" class="sample-select" title="去网格横线灵敏度" style="font-size: 10px; max-width: 60px; padding: 2px 2px;">
            <option value="off">去线:关</option>
            <option value="weak">去线:弱</option>
            <option value="medium" selected>去线:中</option>
            <option value="strong">去线:强</option>
          </select>
        </div>

        <!-- 年代-深度模型视觉检查与解译入口 -->
        <button id="btn-age-depth-modal" class="tool-btn" title="解译并视觉核查同剖面年代-深度模型 (Bacon / Bchron 等)" style="padding: 3px 6px; font-size: 10.5px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.4);">
          <span>⏳ 年代</span>
        </button>

        <!-- 导出主按钮 -->
        <button id="btn-export-csv" class="btn btn-primary" title="打开数据导出与校验控制台 (S7)" style="padding: 4px 10px; font-size: 11px; font-weight: 700; white-space: nowrap;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          <span>导出</span>
        </button>

        <!-- 日夜间主题切换按钮 -->
        <button id="btn-toggle-theme" class="tool-btn" title="切换日间/夜间模式 (快捷键: T)" style="padding: 4px 6px;">
          <svg id="theme-icon-moon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
        </button>

        <div id="rpc-status-pill" class="status-pill ${e?`online`:`mock`}" title="点击配置后端 JSON-RPC" style="padding: 2px 5px; font-size: 9.5px;">
          <span class="status-dot"></span>
          <span class="status-text">${e?`RPC`:`Mock`}</span>
        </div>

        ${this.isDesktopMode?`
          <button id="btn-shutdown" class="tool-btn danger" title="退出程序并安全终止后台服务" style="background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35); padding: 4px 6px;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>
            </svg>
          </button>
        `:``}
      </div>
    `,this.bindEvents()}bindEvents(){this.element.querySelector(`#btn-shutdown`)?.addEventListener(`click`,async()=>{if(!window.confirm(`确定要退出 Straditize Pro 应用程序并停止后台服务吗？`))return;try{await fetch(`/shutdown`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({action:`shutdown`})})}catch{}let e=document.createElement(`div`);e.style.cssText=`position:fixed;inset:0;background:rgba(15,23,42,0.95);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);`,e.innerHTML=`
        <div style="background:#1e293b;padding:36px 48px;border-radius:12px;border:1px solid #334155;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);max-width:440px;">
          <div style="font-size:42px;margin-bottom:12px;">🛑</div>
          <h2 style="font-size:20px;font-weight:700;color:#f8fafc;margin:0 0 8px 0;">服务已安全终止</h2>
          <p style="font-size:14px;color:#94a3b8;margin:0 0 16px 0;">Straditize 后台进程已退出。</p>
          <p style="font-size:13px;color:#64748b;margin:0;">您可以安全关闭此浏览器标签页。</p>
        </div>
      `,document.body.appendChild(e)}),this.element.querySelectorAll(`.workflow-step-btn`).forEach(e=>{e.addEventListener(`click`,()=>{let t=parseInt(e.getAttribute(`data-step`)||`1`,10);this.callbacks.onStepClick?.(t)})}),this.element.querySelector(`#btn-fit`)?.addEventListener(`click`,()=>this.callbacks.onFit()),this.element.querySelector(`#btn-100`)?.addEventListener(`click`,()=>this.callbacks.onReset100()),this.element.querySelector(`#btn-zoom-in`)?.addEventListener(`click`,()=>this.callbacks.onZoomIn()),this.element.querySelector(`#btn-zoom-out`)?.addEventListener(`click`,()=>this.callbacks.onZoomOut()),this.element.querySelector(`#btn-undo`)?.addEventListener(`click`,()=>this.callbacks.onUndo()),this.element.querySelector(`#btn-redo`)?.addEventListener(`click`,()=>this.callbacks.onRedo()),this.element.querySelector(`#btn-digitize`)?.addEventListener(`click`,()=>this.callbacks.onDigitize()),this.element.querySelector(`#btn-calibrate`)?.addEventListener(`click`,()=>this.callbacks.onOpenCalibrationModal()),this.element.querySelector(`#btn-age-depth-modal`)?.addEventListener(`click`,()=>this.callbacks.onOpenAgeDepthModal?.()),this.element.querySelector(`#btn-export-csv`)?.addEventListener(`click`,()=>this.callbacks.onExport(`csv`)),this.element.querySelector(`#btn-export-json`)?.addEventListener(`click`,()=>this.callbacks.onExport(`json`)),this.element.querySelector(`#rpc-status-pill`)?.addEventListener(`click`,()=>this.callbacks.onToggleRpcConfig()),this.element.querySelector(`#btn-toggle-theme`)?.addEventListener(`click`,()=>{let e=document.body.classList.toggle(`theme-light`),t=this.element.querySelector(`#theme-text`),n=this.element.querySelector(`#theme-icon-moon`);t&&(t.textContent=e?`夜间`:`日间`),n&&(n.innerHTML=e?`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`:`<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`)}),this.element.querySelector(`#btn-save-project`)?.addEventListener(`click`,()=>{this.callbacks.onSaveProject?.()});let e=this.element.querySelector(`#file-input-project`);this.element.querySelector(`#btn-open-project`)?.addEventListener(`click`,()=>{e?.click()}),e?.addEventListener(`change`,t=>{let n=t.target.files;n&&n.length>0&&(this.callbacks.onOpenProjectFile?.(n[0]),e.value=``)});let t=this.element.querySelector(`#file-input-image`);this.element.querySelector(`#btn-open-file`)?.addEventListener(`click`,()=>{t?.click()}),t?.addEventListener(`change`,e=>{let n=e.target.files;n&&n.length>0&&(this.callbacks.onOpenFile(n[0]),t.value=``)});let n=this.element.querySelector(`#select-sample-diagram`);n?.addEventListener(`change`,()=>{let e=n.value;e&&this.callbacks.onLoadSample(e)}),this.element.querySelector(`#btn-toggle-binary`)?.addEventListener(`click`,()=>{this.callbacks.onToggleBinaryOverlay()}),this.element.querySelector(`#select-degrid-strength`)?.addEventListener(`change`,e=>{let t=e.target.value;this.callbacks.onChangeDegridStrength?.(t)});let r=this.element.querySelector(`#select-image-mode`);r?.addEventListener(`change`,()=>{this.callbacks.onChangeImageMode(r.value)})}},g=class e{static CANONICAL_TAXA=`Pinus,Pinus canariensis,Pinus sylvestris,Pinus nigra,Abies,Abies alba,Picea,Picea abies,Betula,Betula nana,Betula pendula,Betula pubescens,Alnus,Alnus viridis,Alnus glutinosa,Alnus incana,Quercus,Quercus robur,Quercus ilex,Quercus petraea,Quercus suber,Quercus cerris,Fagus,Fagus sylvatica,Carpinus,Carpinus betulus,Carpinus orientalis,Corylus,Corylus avellana,Castanea,Castanea sativa,Ostrya,Ostrya carpinifolia,Ulmus,Ulmus glabra,Zelkova,Celtis,Tilia,Tilia cordata,Tilia platyphyllos,Fraxinus,Fraxinus excelsior,Fraxinus ornus,Salix,Populus,Populus tremula,Juglans,Juglans regia,Carya,Acer,Acer campestre,Platanus,Liquidambar,Cedrus,Cedrus atlantica,Larix,Larix decidua,Tsuga,Juniperus,Juniperus-type,Cupressaceae,Taxus,Taxus baccata,Ephedra,Ephedra distachya-type,Ephedra fragilis-type,Erica,Erica-type,Erica arborea,Ericaceae,Calluna,Calluna vulgaris,Vaccinium,Olea,Olea europaea,Pistacia,Pistacia lentiscus,Pistacia terebinthus,Myrica,Myrica faya,Tamarix,Hippophae,Hippophae rhamnoides,Rhamnus,Elaeagnus,Sambucus,Viburnum,Artemisia,Artemisia-type,Artemisia sp.,Chenopodiaceae,Chenopodiaceae/Amaranthaceae,Amaranthaceae,Chenopodium,Atriplex,Poaceae,Gramineae,Cerealia-type,Secale-type,Triticum-type,Cyperaceae,Carex,Asteraceae,Asteraceae Asteroideae,Asteraceae Cichorioideae,Asteroideae,Cichorioideae,Tubuliflorae,Liguliflorae,Centaurea,Centaurea jacea-type,Taraxacum-type,Anthemis-type,Brassicaceae,Cruciferae,Plantago,Plantago lanceolata,Plantago major/media,Plantago coronopus,Caryophyllaceae,Stellaria,Cerastium,Silene,Fabaceae,Leguminosae,Trifolium,Lotus,Vicia,Rosaceae,Potentilla-type,Filipendula,Sanguisorba,Sanguisorba minor,Sanguisorba officinalis,Dryas octopetala,Ranunculaceae,Ranunculus-type,Thalictrum,Anemone,Apiaceae,Umbelliferae,Daucus,Polygonaceae,Polygonum,Polygonum bistorta,Polygonum aviculare,Rumex,Rumex acetosella-type,Urticaceae,Urtica,Urtica dioica,Saxifragaceae,Saxifraga,Saxifraga oppositifolia-type,Helianthemum,Geraniaceae,Geranium,Malvaceae,Lamiaceae,Mentha-type,Scrophulariaceae,Campanulaceae,Campanula,Valerianaceae,Valeriana,Rubiaceae,Galium,Plumbaginaceae,Armeria,Typha,Typha latifolia,Typha angustifolia,Sparganium,Sparganium-type,Potamogeton,Myriophyllum,Myriophyllum spicatum,Myriophyllum alterniflorum,Nuphar,Nymphaea,Alisma,Sagittaria,Isoetes,Isoetes lacustris,Isoetes echinospora,Pteridium,Pteridium aquilinum,Polypodiaceae,Polypodium,Polypodium vulgare,Lycopodium,Lycopodium clavatum,Lycopodium annotinum,Huperzia selago,Selaginella,Selaginella selaginoides,Equisetum,Osmunda,Osmunda regalis,Botrychium,Ophioglossum,Sphagnum,Bryophyta`.split(`,`);static normalizedMap=new Map(e.CANONICAL_TAXA.map(e=>[e.toLowerCase(),e]));static cleanRawName(e){return e.replace(/[*_~`"']/g,``).replace(/^[\d+.)\-•\s]+/,``).replace(/\s+/g,` `).trim()}static prehealOcr(e){return e.replace(/0([a-zA-Z])/g,`O$1`).replace(/([a-zA-Z])0/g,`$1o`).replace(/1([a-zA-Z])/g,`l$1`).replace(/5([a-zA-Z])/g,`S$1`).replace(/8([a-zA-Z])/g,`B$1`)}static levenshteinDistance(e,t){let n=e.length,r=t.length,i=Array.from({length:n+1},()=>Array(r+1).fill(0));for(let e=0;e<=n;e++)i[e][0]=e;for(let e=0;e<=r;e++)i[0][e]=e;for(let a=1;a<=n;a++)for(let n=1;n<=r;n++){let r=e[a-1]===t[n-1]?0:1;i[a][n]=Math.min(i[a-1][n]+1,i[a][n-1]+1,i[a-1][n-1]+r),a>1&&n>1&&e[a-1]===t[n-2]&&e[a-2]===t[n-1]&&(i[a][n]=Math.min(i[a][n],i[a-2][n-2]+1))}return i[n][r]}static correct(e){let t=this.cleanRawName(e);if(!t)return{original:e,corrected:``,wasCorrected:!1,confidence:0};let n=this.prehealOcr(t),r=n.toLowerCase();if(this.normalizedMap.has(r)){let e=this.normalizedMap.get(r);return{original:t,corrected:e,wasCorrected:t!==e,confidence:1}}let i=n.match(/([-\s](type|sp\.|spp\.|gr\.|group|t\.))$/i),a=i?i[0]:``,o=a?n.slice(0,-a.length).trim():n,s=o.toLowerCase();if(this.normalizedMap.has(s)){let e=`${this.normalizedMap.get(s)}${a}`;return{original:t,corrected:e,wasCorrected:t!==e,confidence:.98}}let c=[s];s.includes(`m`)&&(c.push(s.replace(/m/g,`in`)),c.push(s.replace(/m/g,`rn`))),s.includes(`rn`)&&c.push(s.replace(/rn/g,`m`)),s.includes(`cl`)&&c.push(s.replace(/cl/g,`d`)),s.includes(`vv`)&&c.push(s.replace(/vv/g,`w`));for(let e of c)if(this.normalizedMap.has(e))return{original:t,corrected:`${this.normalizedMap.get(e)}${a}`,wasCorrected:!0,confidence:.95,note:`基于常见 OCR 扫描连字符形近替换修复`};let l=null,u=1/0,d=0;for(let e of this.CANONICAL_TAXA){let t=e.toLowerCase();for(let n of c){let r=this.levenshteinDistance(n,t),i=1-r/(Math.max(n.length,t.length)||1);i>d&&(d=i,u=r,l=e)}}let f=o.length;return(f<=4&&u<=1&&d>=.75||f>=5&&u<=2&&d>=.72||f>=8&&u<=3&&d>=.72)&&l?{original:t,corrected:a&&!l.toLowerCase().endsWith(a.toLowerCase().trim())?`${l}${a}`:l,wasCorrected:!0,confidence:Number(d.toFixed(2)),note:`词典拼写校正 (相似度 ${(d*100).toFixed(0)}%)`}:{original:t,corrected:t.charAt(0).toUpperCase()+t.slice(1),wasCorrected:!1,confidence:.5}}static parseTaxaList(e,t=!0){return!e||!e.trim()?[]:e.split(/[\r\n\t;]+/).flatMap(e=>e.includes(`,`)&&!e.includes(`(`)?e.split(`,`):[e]).map(e=>e.trim()).filter(e=>e.length>0).map(e=>{if(t)return this.correct(e);let n=this.cleanRawName(e);return{original:n,corrected:n?n.charAt(0).toUpperCase()+n.slice(1):``,wasCorrected:!1,confidence:1}})}},_=class{element;data;callbacks;isCollapsed=!1;isCompactView=!0;searchQuery=``;constructor(e,t){this.data=e,this.callbacks=t,this.element=document.createElement(`aside`),this.element.className=`app-sidebar`,this.render()}getElement(){return this.element}getIsCollapsed(){return this.isCollapsed}setCollapsed(e){this.isCollapsed=e,this.isCollapsed?this.element.classList.add(`collapsed`):this.element.classList.remove(`collapsed`)}toggleCollapse(){return this.setCollapsed(!this.isCollapsed),this.callbacks.onToggleCollapse?.(this.isCollapsed),this.isCollapsed}updateData(e){this.data=e,this.render()}render(){this.element.innerHTML=`
      <div class="sidebar-header">
        <div class="sidebar-title">
          <svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span>Taxa 属种分列清单</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <span class="badge">${this.data.columns.length}</span>
          <button id="btn-toggle-compact" class="tool-btn" style="padding: 2px 5px; font-size: 10px;" title="切换紧凑列表/详细卡片视图">
            ${this.isCompactView?`☲ 卡片`:`≡ 紧凑`}
          </button>
          <button id="btn-collapse-sidebar" class="icon-btn" title="收起侧边栏 (Ctrl+B)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="sidebar-actions-bar" style="display: flex; gap: 4px; padding: 6px 10px 4px 10px;">
        <button id="btn-open-paste-taxa" class="btn-sidebar-action" style="flex: 1;" title="从 Excel / 文献 Word 批量复制并粘贴属种名单">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
            <path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>
          </svg>
          <span>批量导入</span>
        </button>
        <button id="btn-insert-gap-col" class="btn-sidebar-action" title="在当前属种后插入空缺列（抢救中间漏切一列，将后续名字后推一格）" style="width: auto; padding: 4px 8px; font-size: 11px;">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>插空列</span>
        </button>
      </div>

      <div style="padding: 2px 10px 6px 10px;">
        <input type="text" id="inp-search-taxa" placeholder="🔍 快速搜索属种 (输入即过滤)..." value="${this.searchQuery}" style="width: 100%; font-size: 10.5px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); box-sizing: border-box;" />
      </div>

      <div class="taxa-list" id="taxa-list-container">
        ${this.data.columns.filter(e=>!this.searchQuery||e.name.toLowerCase().includes(this.searchQuery.toLowerCase())).map(e=>this.renderTaxaItem(e,e.id===this.data.activeTaxaId)).join(``)}
      </div>

      <div class="sidebar-footer">
        <div class="tip-card">
          <div class="tip-title">⚡ 交互操作指南</div>
          <ul class="tip-list">
            <li><strong>📋 批量导入：</strong>一键从 Excel / Word 粘贴数十列属种名，自动 OCR 纠错</li>
            <li><strong>普通左键单击：</strong>在点击位置直接添加控制点，轮廓吸附拉伸</li>
            <li><strong>左键按住控制点：</strong>实时拖动修改轮廓形态</li>
            <li><strong>右键点击控制点：</strong>直接删除该锚点</li>
            <li><strong>红色垂线：</strong>鼠标悬停拖拽调整属种列基线与分界</li>
            <li><strong>淡蓝横线：</strong>地层深度标尺网格，严格统一层位数据</li>
            <li><strong>Ctrl+Z / Ctrl+Y：</strong>撤销与重做</li>
          </ul>
        </div>
      </div>
    `,this.bindEvents()}renderTaxaItem(e,t){let n=e.controlPoints.filter(e=>e.isManual).length,r=e.controlPoints.length;return this.isCompactView?`
        <div class="taxa-card compact-taxa-row ${t?`active`:``}" data-taxa-id="${e.id}" style="padding: 4px 8px; margin-bottom: 2px; display: flex; align-items: center; justify-content: space-between; gap: 6px; border-radius: 4px; border: 1px solid ${t?`#38bdf8`:`rgba(255,255,255,0.06)`}; background: ${t?`rgba(56,189,248,0.12)`:`rgba(30,41,59,0.35)`};">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
            <span class="color-dot" style="background-color: ${e.color}; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;"></span>
            <input type="text" class="taxa-name-inline-input" data-action="inline-rename" value="${e.name}" style="font-size: 11px; font-weight: ${t?`600`:`400`}; border: none; background: transparent; color: inherit; width: 100%; text-overflow: ellipsis; overflow: hidden; padding: 1px 2px;" title="点击直接改名" />
          </div>
          <div style="display: flex; align-items: center; gap: 2px; flex-shrink: 0;">
            <span style="font-size: 9.5px; color: var(--text-muted); font-family: var(--font-mono); margin-right: 2px;">${r}点</span>
            <button class="icon-btn" data-action="swap-up" title="向上对调属种名称" style="padding: 1px 2px; font-size: 9px; line-height: 1;">▲</button>
            <button class="icon-btn" data-action="swap-down" title="向下对调属种名称" style="padding: 1px 2px; font-size: 9px; line-height: 1;">▼</button>
            <button class="icon-btn toggle-visibility ${e.visible?`visible`:`hidden`}" data-action="toggle-visible" title="显隐属种" style="padding: 2px;">
              ${e.visible?`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`:`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`}
            </button>
          </div>
        </div>
      `:`
      <div class="taxa-card ${t?`active`:``}" data-taxa-id="${e.id}">
        <div class="taxa-header">
          <div class="taxa-title-row">
            <span class="color-dot" style="background-color: ${e.color};"></span>
            <input type="text" class="taxa-name-inline-input" data-action="inline-rename" value="${e.name}" title="点击可直接编辑此属种名称" />
          </div>
          <div style="display: flex; align-items: center; gap: 3px;">
            <button class="icon-btn" data-action="swap-up" title="向上对调属种名称" style="padding: 1px 3px; font-size: 10px; line-height: 1;">▲</button>
            <button class="icon-btn" data-action="swap-down" title="向下对调属种名称" style="padding: 1px 3px; font-size: 10px; line-height: 1;">▼</button>
            <button class="icon-btn toggle-visibility ${e.visible?`visible`:`hidden`}" data-action="toggle-visible" title="显隐属种">
              ${e.visible?`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`:`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`}
            </button>
          </div>
        </div>

        <div class="taxa-meta">
          <div class="meta-item">
            <span>基线范围:</span>
            <code>${e.startX} ~ ${e.endX} px</code>
          </div>
          <div class="meta-item">
            <span>满刻度:</span>
            <code>${e.maxPercent}%</code>
          </div>
          <div class="meta-item">
            <span>锚点总数:</span>
            <span><strong style="color: #fbbf24;">${n}</strong> 手动 / ${r} 点</span>
          </div>
        </div>

        <div class="taxa-actions">
          <div class="btn-group">
            <button class="segmented-btn ${e.curveType===`bezier`?`active`:``}" data-action="curve-bezier">
              贝塞尔平滑
            </button>
            <button class="segmented-btn ${e.curveType===`linear`?`active`:``}" data-action="curve-linear">
              折线连接
            </button>
          </div>
        </div>
      </div>
    `}bindEvents(){this.element.querySelector(`#btn-collapse-sidebar`)?.addEventListener(`click`,()=>{this.toggleCollapse()}),this.element.querySelector(`#btn-toggle-compact`)?.addEventListener(`click`,()=>{this.isCompactView=!this.isCompactView,this.render()});let e=this.element.querySelector(`#btn-open-paste-taxa`);e&&e.addEventListener(`click`,()=>{this.openPasteTaxaModal()}),this.element.querySelector(`#btn-insert-gap-col`)?.addEventListener(`click`,()=>{this.callbacks.onInsertGapColumn?.(this.data.activeTaxaId)});let t=this.element.querySelector(`#inp-search-taxa`);t&&(t.addEventListener(`input`,e=>{this.searchQuery=e.target.value;let t=this.element.querySelector(`#taxa-list-container`);t&&(t.innerHTML=this.data.columns.filter(e=>!this.searchQuery||e.name.toLowerCase().includes(this.searchQuery.toLowerCase())).map(e=>this.renderTaxaItem(e,e.id===this.data.activeTaxaId)).join(``))}),t.addEventListener(`keydown`,e=>{e.key===`Escape`&&(this.searchQuery=``,t.value=``,t.blur(),this.render())}));let n=this.element.querySelector(`#taxa-list-container`);n&&(n.addEventListener(`change`,e=>{let t=e.target;if(t&&t.getAttribute(`data-action`)===`inline-rename`){let e=t.closest(`.taxa-card`)?.getAttribute(`data-taxa-id`),n=this.data.columns.find(t=>t.id===e),r=t.value.trim();n&&r&&r!==n.name&&(n.name=r,this.callbacks.onBatchImportTaxa?.(this.data.columns.map(e=>e.name)))}}),n.addEventListener(`keydown`,e=>{let t=e,n=t.target;n&&n.getAttribute(`data-action`)===`inline-rename`&&t.key===`Enter`&&n.blur()}),n.addEventListener(`click`,e=>{let t=e.target,n=t.closest(`.taxa-card`);if(!n)return;let r=n.getAttribute(`data-taxa-id`);if(r){if(t.closest(`[data-action="swap-up"]`)){e.stopPropagation();let t=this.data.columns.findIndex(e=>e.id===r);t>0&&this.callbacks.onSwapTaxaNames?.(t,t-1);return}if(t.closest(`[data-action="swap-down"]`)){e.stopPropagation();let t=this.data.columns.findIndex(e=>e.id===r);t>=0&&t<this.data.columns.length-1&&this.callbacks.onSwapTaxaNames?.(t,t+1);return}if(t.closest(`[data-action="toggle-visible"]`)){e.stopPropagation(),this.callbacks.onToggleVisible(r);return}if(t.closest(`[data-action="curve-bezier"]`)){e.stopPropagation(),this.callbacks.onChangeCurveType(r,`bezier`);return}if(t.closest(`[data-action="curve-linear"]`)){e.stopPropagation(),this.callbacks.onChangeCurveType(r,`linear`);return}this.callbacks.onSelectTaxa(r)}}))}openPasteTaxaModal(){let e=document.createElement(`div`);e.className=`modal-backdrop`;let t=this.data.columns.length;e.innerHTML=`
      <div class="modal-dialog modal-large paste-taxa-dialog">
        <div class="modal-header">
          <div class="modal-title-wrap">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              <path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>
            </svg>
            <h3>批量导入属种名单 (Paste Taxa List)</h3>
          </div>
          <button class="close-btn" id="paste-modal-close">&times;</button>
        </div>

        <div class="modal-body">
          <p class="modal-description">
            可直接从 <strong>Excel（整行或整列）</strong> 或 <strong>文献 Word</strong> 中复制拉丁属种名单粘贴于此（支持包含 Markdown <i>*Pinus*</i> 格式）。<br>
            系统自动按回车或制表符切分，按图谱<strong>从左到右顺序重命名全部列</strong>；当属种数多于当前列数时，<strong>自动依据列间距向右拓展分列</strong>。
          </p>

          <div class="paste-options-bar">
            <div class="file-import-btn-wrap">
              <button id="btn-upload-taxa-file" class="tool-btn highlight" style="font-size: 11px; padding: 4px 8px;">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>从 CSV / TXT 文件导入</span>
              </button>
              <input type="file" id="taxa-file-input" accept=".csv,.txt,.tsv" style="display: none;" />
            </div>

            <label class="checkbox-label" title="自动匹配标准第四纪古生态词典并修正 OCR 扫描错字 (如 Pmus➔Pinus, Artemesia➔Artemisia)">
              <input type="checkbox" id="chk-enable-glossary" checked />
              <span>启用标准花粉词典自动校正 (Pollen Glossary)</span>
            </label>
            <div class="delimiter-tag">支持换行 (\\n)、制表符 (\\t)、逗号/分号</div>
          </div>

          <div class="form-group">
            <textarea
              id="taxa-raw-input"
              class="paste-taxa-textarea"
              rows="6"
              placeholder="在此直接粘贴 (Ctrl+V) 属种名称列表...&#10;&#10;示例 1 (Excel 列复制 / 回车换行)：&#10;*Pinus canariensis*&#10;Artemesia&#10;Chenopodiacee&#10;Poacee&#10;Betla&#10;&#10;示例 2 (Excel 行复制 / 制表符)：&#10;Pinus&#9;Artemisia&#9;Chenopodiaceae&#9;Poaceae"
            ></textarea>
          </div>

          <!-- 实时解析与 OCR 纠错预览 -->
          <div class="paste-preview-section">
            <div class="preview-header">
              <span id="preview-count-badge" class="preview-badge">已解析: 0 个属种</span>
              <span id="preview-diff-info" class="preview-diff">当前图谱共有 ${t} 列</span>
            </div>
            <div id="preview-chips-container" class="preview-chips-container">
              <div class="preview-placeholder">等待粘贴属种数据...</div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" id="paste-modal-cancel">取消</button>
          <button class="btn btn-primary" id="paste-modal-apply" disabled>
            应用并重命名 / 拓展分列
          </button>
        </div>
      </div>
    `,document.body.appendChild(e);let n=e.querySelector(`#taxa-raw-input`),r=e.querySelector(`#chk-enable-glossary`),i=e.querySelector(`#preview-count-badge`),a=e.querySelector(`#preview-diff-info`),o=e.querySelector(`#preview-chips-container`),s=e.querySelector(`#paste-modal-apply`),c=[],l=()=>{let e=n.value,l=r.checked;c=g.parseTaxaList(e,l);let u=c.length;if(i.textContent=`已解析: ${u} 个属种`,u===0){a.textContent=`当前图谱共有 ${t} 列`,a.className=`preview-diff`,o.innerHTML=`<div class="preview-placeholder">等待粘贴属种数据...</div>`,s.disabled=!0;return}if(s.disabled=!1,u>t){let e=u-t;a.innerHTML=`覆盖前 ${t} 列，并将<strong>自动拓展 ${e} 个新属种列</strong> (保持列间距)`,a.className=`preview-diff expansion-highlight`}else u<t?(a.textContent=`将重命名最左侧 ${u} 列 (其余 ${t-u} 列保留原有名称)`,a.className=`preview-diff`):(a.textContent=`精准覆盖当前全部 ${t} 列`,a.className=`preview-diff match-highlight`);o.innerHTML=c.map((e,t)=>e.wasCorrected?`
              <div class="taxa-chip corrected" title="原始输入: ${e.original}&#10;纠错说明: ${e.note||`OCR 模糊修正`}">
                <span class="chip-index">${t+1}</span>
                <span class="chip-name">${e.corrected}</span>
                <span class="chip-tag">OCR纠正</span>
              </div>
            `:`
            <div class="taxa-chip" title="${e.corrected}">
              <span class="chip-index">${t+1}</span>
              <span class="chip-name">${e.corrected}</span>
            </div>
          `).join(``)};n.addEventListener(`input`,l),r.addEventListener(`change`,l);let u=e.querySelector(`#taxa-file-input`);e.querySelector(`#btn-upload-taxa-file`)?.addEventListener(`click`,()=>{u?.click()}),u?.addEventListener(`change`,e=>{let t=e.target.files;if(t&&t.length>0){let e=t[0],r=new FileReader;r.onload=e=>{let t=e.target?.result||``;n.value=t,l()},r.readAsText(e,`utf-8`),u.value=``}});let d=()=>e.remove();e.querySelector(`#paste-modal-close`)?.addEventListener(`click`,d),e.querySelector(`#paste-modal-cancel`)?.addEventListener(`click`,d),s.addEventListener(`click`,()=>{if(c.length===0)return;let e=c.map(e=>e.corrected);this.callbacks.onBatchImportTaxa&&this.callbacks.onBatchImportTaxa(e),d()}),setTimeout(()=>n.focus(),50)}},v=class{static create(e){let t=1024;for(let n of e){let e=Math.ceil(n.data.length/512)*512;t+=512+e}let n=new Uint8Array(t),r=0;for(let t of e){let e=new Uint8Array(512),i=new TextEncoder().encode(t.name);e.set(i.subarray(0,100),0),e.set(new TextEncoder().encode(`0000644\0`),100),e.set(new TextEncoder().encode(`0000000\0`),108),e.set(new TextEncoder().encode(`0000000\0`),116);let a=t.data.length.toString(8).padStart(11,`0`)+` `;e.set(new TextEncoder().encode(a),124);let o=Math.floor(Date.now()/1e3).toString(8).padStart(11,`0`)+` `;e.set(new TextEncoder().encode(o),136),e[156]=48,e.set(new TextEncoder().encode(`ustar\0`),257),e.set(new TextEncoder().encode(`00`),263);for(let t=148;t<156;t++)e[t]=32;let s=0;for(let t=0;t<512;t++)s+=e[t];let c=s.toString(8).padStart(6,`0`)+`\0 `;e.set(new TextEncoder().encode(c),148),n.set(e,r),r+=512,n.set(t.data,r),r+=Math.ceil(t.data.length/512)*512}return n}static extract(e){let t=new Uint8Array(e),n=[],r=0;for(;r+512<=t.length;){let e=t.subarray(r,r+512),i=!0;for(let t=0;t<512;t++)if(e[t]!==0){i=!1;break}if(i)break;let a=0;for(;a<100&&e[a]!==0;)a++;let o=new TextDecoder().decode(e.subarray(0,a)).trim(),s=124;for(;s<136&&e[s]!==0&&e[s]!==32;)s++;let c=new TextDecoder().decode(e.subarray(124,s)).trim(),l=parseInt(c,8)||0;if(r+=512,o&&l>0&&r+l<=t.length){let e=new Uint8Array(t.subarray(r,r+l));n.push({name:o,data:e})}r+=Math.ceil(l/512)*512}return n}},y=class e{container;data;rpcClient;onCalibrationSave;onProjectLoad;constructor(e,t,n,r,i){this.container=e,this.data=t,this.rpcClient=n,this.onCalibrationSave=r,this.onProjectLoad=i}updateData(e){this.data=e}openCalibrationModal(){let e=document.createElement(`div`);e.className=`modal-backdrop`;let t=this.data.calibration;e.innerHTML=`
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>地层深度与图谱标定设置 (Calibration)</h3>
          <button class="close-btn" id="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <!-- 岩心范围合并为单行：min 至 max，单位由用户自由输入 (cm / m / cal kyr BP) -->
          <div class="form-group">
            <label>岩心范围 (Core Depth Range):</label>
            <div class="input-row">
              <input type="number" id="cal-depth-top" value="${t.depthTopValue}" step="any" placeholder="Min" title="岩心顶部/最年轻层位深度" />
              <span style="color: var(--text-muted);">至</span>
              <input type="number" id="cal-depth-bottom" value="${t.depthBottomValue}" step="any" placeholder="Max" title="岩心底部/最老沉积层深度" />
              <input type="text" id="cal-unit" value="${t.unit}" style="width: 80px;" placeholder="单位" title="自定义深度单位 (如 cm, m, cal kyr BP)" />
            </div>
            <small>设定地质剖面顶部 (Min) 至底部 (Max) 物理跨度与测量单位</small>
          </div>

          <div class="form-group">
            <label>沉积剖面图谱像素 Y 范围 (Y-Limits):</label>
            <div class="input-row">
              <input type="number" id="cal-ymin" value="${t.dataYMin}" />
              <span style="color: var(--text-muted);">至</span>
              <input type="number" id="cal-ymax" value="${t.dataYMax}" />
              <span class="unit-label">px</span>
            </div>
            <small>地学剖面有效图表像素纵轴范围</small>
          </div>

          <div class="form-group">
            <label>剖面标准采样间隔 (Depth Grid Interval):</label>
            <div class="input-row">
              <input type="number" id="cal-depth-interval" value="${t.depthInterval??2}" step="any" min="0.01" />
              <span class="unit-label">${t.unit} / 层位</span>
            </div>
            <small>设定剖面采样间隔（例如从 ${t.depthTopValue} 到 ${t.depthBottomValue} ${t.unit}，每隔 ${t.depthInterval??2} ${t.unit} 作为一个标准层位）</small>
          </div>

          <div class="form-group">
            <div class="checkbox-row" style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
              <input type="checkbox" id="cal-depth-grid" ${t.depthGridEnabled===!1?``:`checked`} style="width: 16px; height: 16px; accent-color: #38bdf8; cursor: pointer;" />
              <label for="cal-depth-grid" style="cursor: pointer; color: var(--text-primary); font-size: 12.5px; font-weight: 500;">
                在画布上显示水平淡蓝色层位标线 (Depth Grid Lines)
              </label>
            </div>
            <small style="margin-left: 24px;">贯穿所有属种列，确保数据直接锚定在这些固定的层位深度上</small>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-cancel">取消</button>
          <button class="btn btn-primary" id="modal-save">保存标定</button>
        </div>
      </div>
    `,this.container.appendChild(e);let n=()=>e.remove();e.querySelector(`#modal-close`)?.addEventListener(`click`,n),e.querySelector(`#modal-cancel`)?.addEventListener(`click`,n),e.querySelector(`#modal-save`)?.addEventListener(`click`,()=>{let r=parseFloat(e.querySelector(`#cal-depth-top`).value)||0,i=parseFloat(e.querySelector(`#cal-depth-bottom`).value)||100,a=e.querySelector(`#cal-unit`).value.trim()||`cm`,o=parseInt(e.querySelector(`#cal-ymin`).value,10)||t.dataYMin,s=parseInt(e.querySelector(`#cal-ymax`).value,10)||t.dataYMax,c=parseFloat(e.querySelector(`#cal-depth-interval`).value)||2,l=e.querySelector(`#cal-depth-grid`).checked,u={...this.data.calibration,depthTopValue:r,depthBottomValue:i,unit:a,dataYMin:o,dataYMax:s,depthInterval:c,depthGridEnabled:l,isCalibrated:!0};this.onCalibrationSave(u),n()})}openExportModal(n=``,r=`csv`){let i=document.createElement(`div`);i.className=`modal-backdrop`,i.innerHTML=`
      <div class="modal-dialog modal-large wpd-export-dialog">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            <h3>数字化数据导出与在线成图 (Acquired Data & Visualize)</h3>
          </div>
          <button class="close-btn" id="modal-close">&times;</button>
        </div>

        <div class="modal-body wpd-modal-body" style="display: flex !important; flex-direction: row !important; gap: 16px; padding: 16px; flex: 1; min-height: 0; box-sizing: border-box;">
          <!-- 左侧：双模式（表格预览与交互编辑 / 原始代码）区域 -->
          <div class="wpd-left-area" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; height: 100%;">
            <!-- 地层丰度百分比总和自检门禁 (Sum Check QA Gate) -->
            <div id="wpd-sum-check-banner" style="padding: 6px 10px; border-radius: 4px; font-size: 11px; display: flex; align-items: center; justify-content: space-between; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); color: #4ade80; flex-shrink: 0;">
              <span id="wpd-sum-check-text">🟢 <strong>百分比总和自检 (Sum Check)</strong>: 分析中...</span>
              <span id="wpd-sum-check-sub" style="font-size: 10px; opacity: 0.85;">-- 层位</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; flex-shrink: 0;">
              <div class="btn-group" style="display: flex; gap: 4px;">
                <button id="tab-btn-grid" class="tool-btn active-mode" style="font-size: 11px; padding: 4px 10px;">📊 数据表格 (可就地编辑)</button>
                <button id="tab-btn-text" class="tool-btn" style="font-size: 11px; padding: 4px 10px;">📝 原始文本 (CSV)</button>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 10px; align-items: center;">
                <span>Variables: <strong id="wpd-vars-label" style="color: var(--accent-blue);">Depth, 29 Taxa</strong></span>
                <span id="wpd-data-size-label">0 KB</span>
                <button id="btn-wpd-reset-edits" class="tool-btn" style="font-size: 10px; padding: 2px 7px; color: var(--text-muted);" title="清除所有手动微调，还原为图谱自动提取值">↺ 还原提取值</button>
              </div>
            </div>

            <!-- 视图 1: 交互式表格视图 (支持直接点选单元格修改数字) -->
            <div id="wpd-table-wrapper" class="wpd-table-wrapper" style="flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border-light); border-radius: 6px; background: rgba(15, 23, 42, 0.6);">
              <table id="wpd-preview-table" class="wpd-preview-table">
                <!-- 动态填充 thead 与 tbody -->
              </table>
            </div>

            <!-- 视图 2: 纯文本导出框 (可复制或手工调整) -->
            <textarea id="wpd-data-textarea" class="export-textarea" style="display: none; flex: 1; min-height: 0; font-family: var(--font-mono); font-size: 11px; line-height: 1.45;"></textarea>

            <div style="font-size: 10px; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
              <span>💡 提示：点击任意表格单元格可直接修改数值（修改项呈橙色高亮），导出 CSV、R 脚本与 TAR 包将实时同步生效。</span>
            </div>
          </div>

          <!-- 右侧：WPD 风格的控制面板 (Dataset, Sort, Format, Visualize) 并列排布 -->
          <div class="wpd-right-controls" style="width: 270px; min-width: 270px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; background: var(--bg-tertiary); padding: 12px; border-radius: 6px; border: 1px solid var(--border-light); height: 100%; box-sizing: border-box; overflow-y: auto;">
            <!-- 数据集选择 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">Dataset (数据集形态):</label>
              <select id="wpd-dataset-select" class="sample-select" style="width: 100%; font-size: 11px;">
                <option value="depth_grid" selected>1. 标准深度层位网格 [推荐: 无NA/全属种对齐]</option>
                <option value="union_points">2. 全属种特征层位并集矩阵 [无NA/极值全捕获]</option>
                <option value="turning_points">3. 离散拐点稀疏特征清单 [原始坐标表]</option>
              </select>
            </div>

            <!-- 排序 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">Sort (排序):</label>
              <div style="display: flex; gap: 6px;">
                <select id="wpd-sort-by" class="sample-select" style="flex: 1; font-size: 11px;">
                  <option value="depth" selected>Depth (深度)</option>
                  <option value="raw">Raw (原始)</option>
                </select>
                <select id="wpd-sort-order" class="sample-select" style="flex: 1; font-size: 11px;">
                  <option value="asc" selected>升序 (顶->底)</option>
                  <option value="desc">降序 (底->顶)</option>
                </select>
              </div>
            </div>

            <!-- 格式化 Format -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">Format (格式化):</label>
              <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">浮点精度:</span>
                  <input type="number" id="wpd-digits" value="2" min="0" max="6" style="width: 60px; font-size: 11px;" />
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">列分隔符:</span>
                  <select id="wpd-col-sep" class="sample-select" style="width: 80px; font-size: 11px;">
                    <option value="," selected>逗号 (,)</option>
                    <option value="	">Tab (\\t)</option>
                    <option value=";">分号 (;)</option>
                    <option value=" ">空格 ( )</option>
                  </select>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: var(--text-muted);">缺测填充:</span>
                  <select id="wpd-na-fill" class="sample-select" style="width: 80px; font-size: 11px;">
                    <option value="0.0" selected>0.0 (地学)</option>
                    <option value="NaN">NaN</option>
                    <option value="NA">NA</option>
                    <option value="">(空)</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="divider" style="margin: 2px 0;"></div>

            <!-- 数据与发表级脚本说明 (Section 八: R 脚本本地出图) -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: #38bdf8;">科研发表级成果导出:</label>
              <p style="font-size: 10px; color: var(--text-muted); line-height: 1.4; margin-bottom: 6px;">
                支持一键生成无 NA 地学标准丰度表、基于 <code>rioja::strat.plot</code> 的自动化出图 R 脚本及 POSIX UStar 标准项目归档。
              </p>
              <div style="background: rgba(15, 23, 42, 0.5); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light); font-size: 10px; color: var(--text-muted); line-height: 1.4;">
                <div style="color: #f59e0b; font-weight: 600; margin-bottom: 2px;">📌 地学科学规范：</div>
                <div>• 未出现属种严格填报 <code>0.00</code></div>
                <div>• 对数分析请自行添加伪计数 (如 +0.01)</div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div style="font-size: 10px; color: var(--text-muted);">
            * 提示：未出现属种严格输出 0.0；可直接导出配套 R 脚本与标准 TAR 归档。
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary" id="btn-wpd-copy">📋 复制</button>
            <button class="btn btn-primary" id="btn-wpd-download-csv">💾 下载 CSV</button>
            <button class="btn btn-secondary" id="btn-wpd-download-r" title="下载配套 R 语言地层绘图脚本 (rioja::strat.plot)">📈 R 脚本</button>
            <button class="btn btn-secondary" id="btn-wpd-download-tar" title="下载包含数据、原图与 R 脚本的标准 TAR 归档包">📦 导出 TAR 包</button>
            <button class="btn btn-secondary" id="btn-wpd-download-json">JSON</button>
          </div>
        </div>
      </div>
    `,this.container.appendChild(i),i.querySelector(`#modal-close`)?.addEventListener(`click`,()=>i.remove());let a=i.querySelector(`#wpd-data-textarea`),s=i.querySelector(`#wpd-dataset-select`),c=i.querySelector(`#wpd-sort-by`),l=i.querySelector(`#wpd-sort-order`),u=i.querySelector(`#wpd-digits`),d=i.querySelector(`#wpd-col-sep`),f=i.querySelector(`#wpd-na-fill`),p=i.querySelector(`#wpd-vars-label`),m=i.querySelector(`#wpd-data-size-label`),h=[],g=[],_=new Map,v=i.querySelector(`#tab-btn-grid`),y=i.querySelector(`#tab-btn-text`),b=i.querySelector(`#wpd-table-wrapper`),x=i.querySelector(`#wpd-preview-table`),S=i.querySelector(`#btn-wpd-reset-edits`);v?.addEventListener(`click`,()=>{v.classList.add(`active-mode`),y?.classList.remove(`active-mode`),b.style.display=`block`,a.style.display=`none`}),y?.addEventListener(`click`,()=>{y.classList.add(`active-mode`),v?.classList.remove(`active-mode`),b.style.display=`none`,a.style.display=`block`});let C=()=>{let e=s.value,n=parseInt(u.value,10)||2,r=f.value,i=l.value===`desc`,a=this.data.calibration,c=this.data.columns.filter(e=>e.visible);if(e===`turning_points`){p.textContent=`Taxon, Type, Depth, Value, X, Y`;let e=[`Taxon`,`Type`,`Depth_${a.unit}`,`Value`,`X_px`,`Y_px`],t=[];return c.forEach(e=>{[...e.controlPoints].sort((e,t)=>i?t.y-e.y:e.y-t.y).forEach(i=>{let s=o.imageYToDepth(i.y,a),c=o.imageXToPercent(i.x,e);t.push([e.name,i.type||`transition`,s===void 0?r:s.toFixed(n),c===void 0?r:c.toFixed(n),String(i.x),String(i.y)])})}),{headers:e,rows:t}}if(e===`union_points`){p.textContent=`Depth_${a.unit}, ${c.length} Taxa (Union Horizons: 0 NA)`;let e=new Set;c.forEach(t=>{t.controlPoints.forEach(t=>e.add(t.y))});let s=Array.from(e).sort((e,t)=>i?t-e:e-t),l=[`Depth_${a.unit}`,...c.map(e=>e.name)],u=[];for(let e of s){let i=o.imageYToDepth(e,a),s=[i===void 0?r:i.toFixed(n)];for(let i of c){let a=t.interpolatePercentAtY(i,e);s.push(a!==void 0&&!isNaN(a)?a.toFixed(n):r)}u.push(s)}return{headers:l,rows:u}}p.textContent=`Depth_${a.unit}, ${c.length} Taxa`;let{depths:d,yPositions:m}=t.getStandardDepthHorizons(a),h=[`Depth_${a.unit}`,...c.map(e=>e.name)],g=[],_=Array.from({length:d.length},(e,t)=>t);i&&_.reverse();for(let e of _){let i=d[e],a=m[e],o=[i.toFixed(n)];for(let e of c){let i=t.interpolatePercentAtY(e,a);i!==void 0&&!isNaN(i)?o.push(i.toFixed(n)):o.push(r)}g.push(o)}return{headers:h,rows:g}},w=(e,t)=>{let n=d.value===`	`?`	`:d.value,r=[e.join(n)];for(let e of t)r.push(e.join(n));return r.join(`
`)},T=()=>{x.innerHTML=``;let e=document.createElement(`thead`),t=document.createElement(`tr`),n=document.createElement(`th`);n.className=`col-row-num`,n.textContent=`#`,t.appendChild(n),h.forEach((e,n)=>{let r=document.createElement(`th`);n===0&&(r.className=`col-depth`),r.textContent=e,t.appendChild(r)}),e.appendChild(t),x.appendChild(e);let r=document.createElement(`tbody`);g.forEach((e,t)=>{let n=document.createElement(`tr`),i=document.createElement(`td`);i.className=`col-row-num`,i.textContent=String(t+1),n.appendChild(i),e.forEach((e,r)=>{let i=document.createElement(`td`);if(r===0)i.className=`col-depth`,i.textContent=e;else{let n=document.createElement(`input`);n.className=`wpd-cell-input`;let a=`${t}_${r}`;_.has(a)?(n.classList.add(`user-modified`),n.value=_.get(a)):n.value=e,n.addEventListener(`input`,()=>{_.set(a,n.value),n.classList.add(`user-modified`),g[t][r]=n.value,E(),D()}),i.appendChild(n)}n.appendChild(i)}),r.appendChild(n)}),x.appendChild(r)},E=()=>{let e=w(h,g);a.value=e,m.textContent=`${(e.length/1024).toFixed(1)} KB (${g.length} rows)`},D=()=>{let e=i.querySelector(`#wpd-sum-check-banner`),t=i.querySelector(`#wpd-sum-check-text`),n=i.querySelector(`#wpd-sum-check-sub`);if(!e||!t||!n)return;if(s.value===`turning_points`||g.length===0){e.style.display=`none`;return}e.style.display=`flex`;let r=0,a=999999,o=0,c=0;for(let e of g){let t=0;for(let n=1;n<e.length;n++){let r=parseFloat(e[n]);isNaN(r)||(t+=r)}t>0&&(r+=t,a=Math.min(a,t),o=Math.max(o,t),c++)}let l=c>0?r/c:100;n.textContent=`${c} 层位质检`,a>=85&&o<=115?(e.style.background=`rgba(34, 197, 94, 0.1)`,e.style.borderColor=`rgba(34, 197, 94, 0.3)`,e.style.color=`#4ade80`,t.innerHTML=`🟢 <strong>地层百分比总和自检 (Sum Check)</strong>: 全剖面平均总和 <strong>${l.toFixed(1)}%</strong> (各层位介于 ${a.toFixed(1)}% ~ ${o.toFixed(1)}%，质检达标)`):(e.style.background=`rgba(245, 158, 11, 0.12)`,e.style.borderColor=`rgba(245, 158, 11, 0.4)`,e.style.color=`#fbbf24`,t.innerHTML=`⚠️ <strong>质检提示 (Sum Warning)</strong>: 存在层位总和偏离 100% (范围: <strong>${a===999999?0:a.toFixed(1)}% ~ ${o.toFixed(1)}%</strong>)，请检查是否有穿透越界峰或漏识属种`)},O=()=>{let{headers:e,rows:t}=C();h=e,g=t.map((e,t)=>e.map((e,n)=>{let r=`${t}_${n}`;return _.has(r)?_.get(r):e})),T(),E(),D()};S?.addEventListener(`click`,()=>{_.clear(),O()}),s.addEventListener(`change`,()=>{_.clear(),O()}),c.addEventListener(`change`,O),l.addEventListener(`change`,O),u.addEventListener(`input`,O),d.addEventListener(`change`,E),f.addEventListener(`change`,O),O();let k=i.querySelector(`#btn-wpd-copy`);k?.addEventListener(`click`,async()=>{await navigator.clipboard.writeText(a.value),k.textContent=`✅ 已复制!`,setTimeout(()=>k.textContent=`📋 复制到剪贴板`,1500)}),i.querySelector(`#btn-wpd-download-csv`)?.addEventListener(`click`,()=>{let e=new Blob([a.value],{type:`text/csv;charset=utf-8;`}),t=URL.createObjectURL(e),n=document.createElement(`a`);n.href=t,n.download=`straditize_pollen_${Date.now()}.csv`,n.click(),URL.revokeObjectURL(t)}),i.querySelector(`#btn-wpd-download-json`)?.addEventListener(`click`,()=>{let e=JSON.stringify(this.data,null,2),t=new Blob([e],{type:`application/json`}),n=URL.createObjectURL(t),r=document.createElement(`a`);r.href=n,r.download=`straditize_data_${Date.now()}.json`,r.click(),URL.revokeObjectURL(n)}),i.querySelector(`#btn-wpd-download-r`)?.addEventListener(`click`,()=>{let t=e.generateRScript(this.data.columns,this.data.calibration.unit||`cm`),n=new Blob([t],{type:`text/plain;charset=utf-8;`}),r=URL.createObjectURL(n),i=document.createElement(`a`);i.href=r,i.download=`plot_strat.R`,i.click(),URL.revokeObjectURL(r)}),i.querySelector(`#btn-wpd-download-tar`)?.addEventListener(`click`,()=>{this.saveProjectFile()})}async saveProjectFile(){let t=this.data.calibration,n={version:`2.0.0`,tool:`straditize pro`,timestamp:new Date().toISOString(),schema_version:`2.0`},r={version:`2.0.0`,image:{path:`image/original.png`,width:this.data.imageWidth,height:this.data.imageHeight},depth_calibration:{top_px:t.top_px??t.dataYMin,bottom_px:t.bottom_px??t.dataYMax,top_cm:t.top_cm??t.depthTopValue,bottom_cm:t.bottom_cm??t.depthBottomValue,unit:t.unit||`cm`,depthInterval:t.depthInterval||2,depthGridEnabled:t.depthGridEnabled??!0,isCalibrated:t.isCalibrated??!0},roi:{x:t.dataXMin,y:t.dataYMin,w:t.dataXMax-t.dataXMin,h:t.dataYMax-t.dataYMin},columns:this.data.columns.map(e=>({id:e.id,species:e.name,name:e.name,color:e.color,visible:e.visible,scale_type:e.scale_type||`linear`,startX:e.startX,startValue:e.startValue??e.scaleCalib?.originVal??0,tickEndX:e.tickEndX??e.endX,tickValue:e.tickValue??e.scaleCalib?.calibVal??e.maxPercent??100,endX:e.endX,curveType:e.curveType,unit:e.unit,points:(e.controlPoints||[]).map(t=>({x:t.x,y:t.y,value:t.value??o.imageXToValue(t.x,e),kind:t.kind||(t.type===`manual`||t.isManual?`manual`:`peak`),valid_segment:t.valid_segment??!0})),controlPoints:e.controlPoints,scaleCalib:e.scaleCalib})),calibration:t,activeTaxaId:this.data.activeTaxaId},i=[];i.push({name:`manifest.json`,data:new TextEncoder().encode(JSON.stringify(n,null,2))}),i.push({name:`straditize.json`,data:new TextEncoder().encode(JSON.stringify(r,null,2))});try{if(this.data.imageSrc){let e=null;if(this.data.imageSrc.startsWith(`data:`)){let t=this.data.imageSrc.split(`,`),n=atob(t[1]||``),r=n.length,i=new Uint8Array(r);for(let e=0;e<r;e++)i[e]=n.charCodeAt(e);e=i}else{let t=await(await fetch(this.data.imageSrc)).arrayBuffer();e=new Uint8Array(t)}e&&i.push({name:`image/original.png`,data:e})}}catch(e){console.warn(`Failed to embed raw image into project tar:`,e)}let a=this.generateStandardCsv();i.push({name:`data.csv`,data:new TextEncoder().encode(a)});let s=e.generateRScript(this.data.columns,this.data.calibration.unit||`cm`);i.push({name:`plot_strat.R`,data:new TextEncoder().encode(s)}),i.push({name:`README.txt`,data:new TextEncoder().encode(`Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)
================================================================

Archive File Hierarchy:
-----------------------
manifest.json      - Metadata, tool version, and timestamp.
image/original.png - High-resolution original stratigraphic diagram image.
straditize.json    - Full vector project model (ROI, columns, control points, calibrations).
data.csv           - Calibrated stratigraphic abundance matrix (Depth in 1st column, unobserved taxa = 0.0).
plot_strat.R       - Automated R script to render publication-quality diagram via rioja::strat.plot.
README.txt         - Archive documentation and scientific notices.

CRITICAL SCIENTIFIC NOTICES (Section 八):
----------------------------------------
1. In data.csv, unobserved taxa are strictly encoded as 0.0 (never NA).
2. Before taking log transformations or log-ratio calculations, please add an appropriate pseudocount (e.g. +0.01 or +0.1) to avoid log(0) undefined errors.

Reproduce Stratigraphic Diagram in R:
-------------------------------------
1. Extract tar archive:  tar -xf <filename>.tar
2. Run script:           Rscript plot_strat.R
`)});let c=v.create(i),l=new Blob([c],{type:`application/x-tar`}),u=URL.createObjectURL(l),d=document.createElement(`a`);d.href=u,d.download=`straditize_project_${Date.now()}.tar`,d.click(),URL.revokeObjectURL(u)}generateStandardCsv(){let e=this.data.calibration,n=this.data.columns.filter(e=>e.visible),{depths:r,yPositions:i}=t.getStandardDepthHorizons(e),a=[[`Depth_${e.unit||`cm`}`,...n.map(e=>`"${e.name}"`)].join(`,`)];for(let e=0;e<r.length;e++){let o=r[e],s=i[e],c=[o.toFixed(2)];for(let e of n){let n=t.interpolatePercentAtY(e,s);n!==void 0&&!isNaN(n)?(e.hasExaggeration&&e.exaggerationMult&&e.exaggerationMult>1&&(n/=e.exaggerationMult),c.push(n.toFixed(2))):c.push(`0.00`)}a.push(c.join(`,`))}return a.join(`
`)}static generateRScript(e,t=`cm`){let n=e.filter(e=>e.visible),r=n.map(e=>e.plotType===`bar`||e.plotType===`line`||e.plotType===`symbol`?`FALSE`:`TRUE`).join(`, `),i=n.map(e=>e.plotType===`bar`?`TRUE`:`FALSE`).join(`, `),a=n.map(e=>e.plotType===`line`?`TRUE`:`FALSE`).join(`, `),o=n.some(e=>e.hasExaggeration),s=Math.max(5,...n.filter(e=>e.hasExaggeration).map(e=>e.exaggerationMult||5)),c=n.map(e=>e.hasExaggeration?`TRUE`:`FALSE`).join(`, `),l=o?`  exag = plot_exag,\n  exag.mult = ${s},\n  col.exag = "auto",\n  exag.alpha = 0.5,\n`:``;return`# ==============================================================================
# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script
# Generated automatically by Straditize v2.0 (straditize pro)
# Requires R package 'rioja' (install.packages("rioja"))
# ==============================================================================

if (!requireNamespace("rioja", quietly = TRUE)) {
  message("Installing required package 'rioja' from CRAN...")
  install.packages("rioja", repos = "https://cloud.r-project.org")
}
library(rioja)

# 1. Locate and load exported stratigraphic CSV table
data_file <- "data.csv"
if (!file.exists(data_file)) {
  csv_candidates <- list.files(pattern = "\\\\.csv$", full.names = TRUE)
  if (length(csv_candidates) > 0) {
    data_file <- csv_candidates[1]
  } else {
    stop("Cannot find data.csv in current directory.")
  }
}

message("Loading stratigraphic dataset from: ", data_file)
df <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)

# Extract depth horizon (first column) and taxa abundance matrix
depth <- df[[1]]
taxa_data <- df[, -1, drop = FALSE]

# Ensure matrix is strictly numeric, replace any residual NAs with 0
taxa_matrix <- as.matrix(sapply(taxa_data, as.numeric))
taxa_matrix[is.na(taxa_matrix)] <- 0

# 2. Configure per-column plot styles based on user selections in Straditize Pro
plot_poly <- c(${r})
plot_bar  <- c(${i})
plot_line <- c(${a})
${o?`plot_exag <- c(${c})`:``}

# 3. Render stratigraphic plot using rioja::strat.plot
message("Rendering stratigraphic pollen profile...")
strat.plot(
  d = taxa_matrix,
  yvar = depth,
  y.rev = TRUE,             # Depth increases downwards (standard geological convention)
  ylabel = paste0("Depth (", "${t}", ")"),
  plot.poly = plot_poly,    # Silhouette area fill
  plot.line = plot_line,    # Pure line curves
  plot.bar = plot_bar,      # Discrete horizontal bars
  col.poly = "grey35",
  col.line = "black",
  lwd.line = 1.0,
  scale.percent = TRUE,     # Percentage scale labels
${l}  xRight = 0.95,
  yTop = 0.88,
  title = "Stratigraphic Pollen Diagram (Straditize Pro)"
)

message("Finished! Stratigraphic plot generated successfully.")
`}openProjectFile(e){let t=e.name.toLowerCase().endsWith(`.tar`)||e.name.toLowerCase().endsWith(`.tar.gz`)||e.type.includes(`tar`),n=(e,t)=>{let n=e.calibration||e.depth_calibration,r=e.columns;if(!r||!Array.isArray(r)||!n)return null;let i={dataXMin:n.dataXMin??e.roi?.x??0,dataXMax:n.dataXMax??(e.roi?e.roi.x+e.roi.w:1e3),dataYMin:n.dataYMin??n.top_px??e.roi?.y??0,dataYMax:n.dataYMax??n.bottom_px??(e.roi?e.roi.y+e.roi.h:1e3),depthTopValue:n.depthTopValue??n.top_cm??0,depthBottomValue:n.depthBottomValue??n.bottom_cm??150,unit:n.unit||`cm`,depthInterval:n.depthInterval??n.depth_interval??2,depthGridEnabled:n.depthGridEnabled??n.depth_grid_enabled??!0,isCalibrated:n.isCalibrated??n.is_calibrated??!0,top_px:n.top_px??n.dataYMin,bottom_px:n.bottom_px??n.dataYMax,top_cm:n.top_cm??n.depthTopValue,bottom_cm:n.bottom_cm??n.depthBottomValue},a=r.map((e,t)=>{let n=e.name||e.species||`Col ${t+1}`,r=e.startX??0,i=e.tickEndX??e.scaleCalib?.calibX??e.endX??r+50,a=e.endX??i,o=e.startValue??e.scaleCalib?.originVal??0,s=e.tickValue??e.scaleCalib?.calibVal??e.maxPercent??100,c=(e.controlPoints||e.points||[]).map((e,n)=>({id:e.id||`pt_${t}_${n}`,x:e.x,y:e.y,value:e.value,kind:e.kind||(e.type===`manual`||e.isManual?`manual`:`peak`),valid_segment:e.valid_segment??!0,isManual:e.kind===`manual`||e.isManual||!1,type:e.kind||e.type||`peak`,createdAt:e.createdAt||Date.now()}));return{id:e.id||`col_${t}`,name:n,species:n,color:e.color||`#38bdf8`,startX:r,endX:a,maxPercent:s,tickEndX:i,unit:e.unit||`%`,isLocked:e.isLocked||!1,curveType:e.curveType||`linear`,visible:e.visible!==!1,scale_type:e.scale_type||`linear`,startValue:o,tickValue:s,controlPoints:c,points:c,scaleCalib:e.scaleCalib||{originX:r,originVal:o,calibX:i,calibVal:s,unit:e.unit||`%`}}});return{imageSrc:t||e.image?.src||e.imageSrc||this.data.imageSrc,imageWidth:e.image?.width||e.imageWidth||this.data.imageWidth,imageHeight:e.image?.height||e.imageHeight||this.data.imageHeight,calibration:i,columns:a,activeTaxaId:e.activeTaxaId||a[0]?.id||``,selectedEntity:null}};if(t){let t=new FileReader;t.onload=e=>{try{let t=e.target?.result;if(!t)return;let r=v.extract(t);if(r.length===0){alert(`读取 .tar 归档失败：未找到有效的文件块。`);return}let i=null,a=null;for(let e of r)if(e.name.endsWith(`straditize.json`)||e.name.endsWith(`wpd.json`)||e.name.endsWith(`.json`)&&!e.name.includes(`manifest.json`)&&!e.name.includes(`info.json`))i=new TextDecoder().decode(e.data);else if(e.name.endsWith(`.png`)||e.name.endsWith(`.jpg`)||e.name.endsWith(`.jpeg`)||e.name.endsWith(`.webp`)){let t=e.name.endsWith(`.jpg`)||e.name.endsWith(`.jpeg`)?`image/jpeg`:`image/png`,n=new Blob([e.data],{type:t});a=URL.createObjectURL(n)}if(i){let e=JSON.parse(i),t=n(e,a);t?this.onProjectLoad&&this.onProjectLoad(t):alert(`解包成功，但未在 JSON 中找到合法的 columns 或 calibration 字段。`)}else alert(`未在 .tar 归档中找到项目数据 JSON 文件。`)}catch(e){alert(`解析 .tar 归档失败：`+e.message)}},t.readAsArrayBuffer(e);return}let r=new FileReader;r.onload=e=>{try{let t=e.target?.result||``,r=JSON.parse(t),i=n(r,null);i?this.onProjectLoad&&this.onProjectLoad(i):alert(`项目文件格式不匹配：未找到有效的 columns 或 calibration 配置。`)}catch{alert(`读取项目文件失败：无效的 JSON 格式。`)}},r.readAsText(e,`utf-8`)}openRpcConfigModal(e){let t=document.createElement(`div`);t.className=`modal-backdrop`;let n=this.rpcClient.getStatus();t.innerHTML=`
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Agent 2 JSON-RPC 服务连接配置</h3>
          <button class="close-btn" id="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin-bottom: 16px;">
            前端自带高仿真 Mock 引擎，即使后端服务未启动也可完全自主交互、加点吸附、撤销重做和导出数据；
            当 Agent 2 的 JSON-RPC 服务启动时，可在此输入地址无缝直连。
          </p>
          <div class="form-group">
            <label>JSON-RPC 2.0 Endpoint 地址:</label>
            <input type="text" id="rpc-endpoint" value="${n.endpoint}" />
          </div>
          <div class="form-group">
            <label>当前运行模式:</label>
            <div class="mode-pill ${n.connected?`online`:`mock`}">
              ${n.connected?`🟢 已连接到后端 Agent 2`:`🟡 本地 Mock 仿真自主运行 (无后端)`}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-close-btn">关闭</button>
          <button class="btn btn-primary" id="btn-probe">重新探测连接</button>
        </div>
      </div>
    `,this.container.appendChild(t);let r=()=>t.remove();t.querySelector(`#modal-close`)?.addEventListener(`click`,r),t.querySelector(`#modal-close-btn`)?.addEventListener(`click`,r);let i=t.querySelector(`#btn-probe`);i?.addEventListener(`click`,async()=>{let n=t.querySelector(`#rpc-endpoint`).value;i.disabled=!0,i.textContent=`探测中...`,await this.rpcClient.probeBackend(n),i.disabled=!1,i.textContent=`重新探测连接`,e(),r()})}},b=class{element;data;history;callbacks;isCollapsed=!1;currentStage=3;constructor(e,t,n){this.data=e,this.history=t,this.callbacks=n,this.element=document.createElement(`aside`),this.element.className=`app-inspector`,this.render()}getElement(){return this.element}getIsCollapsed(){return this.isCollapsed}setCollapsed(e){this.isCollapsed=e,this.isCollapsed?this.element.classList.add(`collapsed`):this.element.classList.remove(`collapsed`)}setWorkflowStage(e){this.currentStage=e,this.render()}toggleCollapse(){return this.setCollapsed(!this.isCollapsed),this.callbacks.onToggleCollapse(this.isCollapsed),this.isCollapsed}updateData(e){this.data=e,this.render()}render(){let e=this.data.columns.find(e=>e.id===this.data.activeTaxaId),t=this.data.selectedEntity,n=this.data.calibration,r=``;if(t?.type===`point`){let i=this.data.columns.find(e=>e.id===t.colId),a=i?.controlPoints.find(e=>e.id===t.pointId);r=i&&a?this.renderPointInspector(i,a):this.renderStagePanel(e,n)}else r=t?.type===`column`&&e?this.renderColumnInspector(e):this.renderStagePanel(e,n);this.element.innerHTML=`
      <div class="inspector-header">
        <div class="inspector-title">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/>
          </svg>
          <span>属性检查器</span>
        </div>
        <button id="btn-collapse-inspector" class="icon-btn" title="收起/展开面板 (快捷键: ])">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      <div class="inspector-body">
        ${r}
      </div>
    `,this.bindEvents()}renderStagePanel(e,t){switch(this.currentStage){case 0:return this.renderS0Panel();case 1:return this.renderS1RoiPanel(t);case 2:return this.renderS2CleanPanel(t);case 3:return this.renderS3ColumnsPanel(e);case 4:return e?this.renderColumnInspector(e):this.renderS3ColumnsPanel(e);case 5:return e?this.renderS5DigitizePanel(e):this.renderProjectOverview(t);case 6:return this.renderS6VerificationPanel();case 7:return this.renderS7ExportPanel();default:return e?this.renderColumnInspector(e):this.renderProjectOverview(t)}}renderS0Panel(){return`
      <div class="inspector-section">
        <div class="section-title">S0：空状态</div>
        <div class="tip-card" style="margin: 0; background: rgba(56, 189, 248, 0.08); border-color: rgba(56, 189, 248, 0.3);">
          <p style="font-size: 11px; line-height: 1.6; color: ${s.color.text.secondary}; margin: 0;">
            当前尚未载入地层图谱图像。<br><br>
            请点击顶栏 <strong>[📁 图谱]</strong> 按钮，或直接将图片文件拖拽至中央画布区域。
          </p>
        </div>
      </div>
    `}renderS1RoiPanel(e){return`
      <div class="inspector-section">
        <div class="section-title">S1：界定纯数据有效区 (ROI)</div>
        <div class="tip-card" style="margin-bottom: 10px; border-left: 3px solid #38bdf8; background: rgba(56, 189, 248, 0.08); padding: 8px 10px;">
          <p style="font-size: 11px; line-height: 1.5; color: #bae6fd; margin: 0;">
            <strong>工作流要点：</strong><br>
            请在画布上拖拽 8 个十字手柄框选花粉数据区，<strong>务必将左侧 Y 轴线、右侧聚类树和底部 X 刻度排除在外</strong>，确保分列 100% 准确。
          </p>
        </div>
        <div class="form-group">
          <label>顶界深度 (Top Depth):</label>
          <div class="input-row">
            <input type="number" id="inp-roi-top" value="${e.depthTopValue}" step="1" />
            <input type="text" id="inp-roi-unit" value="${e.unit}" style="width: 55px;" />
          </div>
        </div>
        <div class="form-group">
          <label>底界深度 (Bottom Depth):</label>
          <div class="input-row">
            <input type="number" id="inp-roi-bot" value="${e.depthBottomValue}" step="1" />
            <span class="unit-label">${e.unit}</span>
          </div>
        </div>
        <div class="form-group">
          <label>有效区像素 X 范围:</label>
          <div class="input-row">
            <input type="number" id="inp-roi-xmin" value="${e.dataXMin}" />
            <span style="color:#64748b;">~</span>
            <input type="number" id="inp-roi-xmax" value="${e.dataXMax}" />
          </div>
        </div>
        <div class="form-group">
          <label>有效区像素 Y 范围:</label>
          <div class="input-row">
            <input type="number" id="inp-roi-ymin" value="${e.dataYMin}" />
            <span style="color:#64748b;">~</span>
            <input type="number" id="inp-roi-ymax" value="${e.dataYMax}" />
          </div>
        </div>
        <button id="btn-apply-roi" class="btn btn-primary" style="width: 100%; margin-top: 10px;">
          保存有效区设置
        </button>
      </div>
    `}renderS2CleanPanel(e){return`
      <div class="inspector-section">
        <div class="section-title">S2：数据区域与图像清理</div>
        <div class="prop-row" style="margin-bottom: 8px;">
          <span class="prop-label">有效区尺寸:</span>
          <span class="prop-val">${e.dataXMax-e.dataXMin} × ${e.dataYMax-e.dataYMin} px</span>
        </div>
        <div class="form-group" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light);">
          <label style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 6px;">图像去横线与网格降噪:</label>
          <select id="select-inspector-degrid" class="sample-select" style="width: 100%; font-size: 11px; margin-bottom: 6px;">
            <option value="off">去横线: 关闭</option>
            <option value="weak">去横线: 弱 (仅细线)</option>
            <option value="medium" selected>去横线: 中 (推荐)</option>
            <option value="strong">去横线: 强 (粗网格)</option>
          </select>
          <small style="font-size: 10px; color: var(--text-muted); line-height: 1.4; display: block;">
            提示: 按键盘 <strong>B</strong> 键可在画布上即时透视查看被切除的横线（鲜红色标记）。
          </small>
        </div>
      </div>
    `}renderS3ColumnsPanel(e){return`
      <div class="inspector-section">
        <div class="section-title">S3：分列与属种名单对齐</div>
        <div class="tip-card" style="margin-bottom: 10px; background: rgba(56, 189, 248, 0.06);">
          <p style="font-size: 11px; line-height: 1.5; color: var(--text-secondary); margin: 0;">
            当前已识别出 <strong>${this.data.columns.length}</strong> 个属种列。<br>
            • 在侧边栏使用 <strong>[批量导入]</strong> 粘贴名单<br>
            • 发现漏列点击 <strong>[➕插空列]</strong><br>
            • 使用 <strong>▲/▼</strong> 箭头就地对调顺位
          </p>
        </div>
        ${e?this.renderColumnInspector(e):``}
      </div>
    `}renderS5DigitizePanel(e){return`
      <div class="inspector-section">
        <div class="section-title">S5：轮廓精修与特征拐点</div>
        ${this.renderColumnInspector(e)}
      </div>
    `}renderS6VerificationPanel(){return`
      <div class="inspector-section">
        <div class="section-title">S6：地学校验与图层审查</div>
        <div class="form-group" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light); margin-bottom: 12px;">
          <label style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 8px;">图层显隐开关 (Layer Toggles):</label>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-secondary);">
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-ghost" checked />
              <span>🟢 绿色原位半透明重叠层 (Visual Ghosting)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-curves" checked />
              <span>🌊 属种轮廓曲线与面积填充</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-anchors" checked />
              <span>🟡 稀疏物理拐点手柄</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-grid" checked />
              <span>📏 地层标准深度网格线</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-roi" checked />
              <span>🟦 ROI 数据有效区边框</span>
            </label>
          </div>
        </div>

        <button id="btn-inspector-open-table" class="btn btn-primary" style="width: 100%; font-size: 11.5px; padding: 7px;">
          📊 打开数据表格与 100% 总和自检
        </button>
      </div>
    `}renderS7ExportPanel(){return`
      <div class="inspector-section">
        <div class="section-title">S7：导出交付 (Export)</div>
        <div class="tip-card" style="margin-bottom: 12px; background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.3);">
          <p style="font-size: 11px; line-height: 1.5; color: #4ade80; margin: 0;">
            <strong>科学导出已就绪：</strong><br>
            • CSV 矩阵首列严格为 depth，未出现属种为 0.0<br>
            • POSIX UStar .tar 开放归档兼容任意系统<br>
            • rioja 脚本自动适配每列形态与放大倍数
          </p>
        </div>
        <button id="btn-inspector-open-export" class="btn btn-primary" style="width: 100%; font-size: 12px; padding: 8px;">
          💾 打开科学数据导出面板
        </button>
      </div>
    `}renderProjectOverview(e){let t=this.data.columns.length,n=e.depthBottomValue-e.depthTopValue,r=e.depthInterval||2,i=Math.round(n/r)+1;return`
      <div class="inspector-section">
        <div class="section-title">地质剖面与数据区概览</div>
        <div class="property-grid">
          <div class="prop-row">
            <span class="prop-label">底图分辨率:</span>
            <span class="prop-val">${this.data.imageWidth} × ${this.data.imageHeight} px</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">属种列总数:</span>
            <span class="prop-val"><strong style="color: #38bdf8;">${t}</strong> 列</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">沉积深度跨度:</span>
            <span class="prop-val">${e.depthTopValue} ~ ${e.depthBottomValue} ${e.unit}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">标准层位采样点:</span>
            <span class="prop-val">${i} 层 (Δ=${r}${e.unit})</span>
          </div>
        </div>
      </div>
    `}renderColumnInspector(e){let t=e.scaleCalib||{originX:e.startX,originVal:e.startValue??0,calibX:e.tickEndX&&e.tickEndX>e.startX?e.tickEndX:e.endX,calibVal:e.maxPercent??20,unit:e.unit||`%`},n=e.scale_type||`linear`,r=o.validateLogScale(e),i=r.valid;return`
      <div class="inspector-section">
        <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>属种列属性: ${e.name.toUpperCase()}</span>
          <span class="badge" style="background:${e.color}22; color:${e.color}; border:1px solid ${e.color}66;">${e.plotType||`area`}</span>
        </div>

        <div class="form-group">
          <label>属种名称 (Taxa Name):</label>
          <input type="text" id="inp-col-name" value="${e.name}" class="text-input" />
        </div>

        <div class="form-group" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px; font-weight: bold; color: ${s.color.column.baseline};">📍 两点式 X 轴物理刻度标定</label>
            <span style="font-size: 9.5px; color: var(--text-muted);">斜率: ${o.getScaleRatio(e).toFixed(3)} ${e.unit||`%`}/px</span>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 6px;">
            <div style="flex: 1;">
              <label style="font-size: 10px; color: var(--text-muted);">端点 1 (原点像素 X):</label>
              <input type="number" id="inp-sc-origin-x" value="${t.originX}" style="font-size: 11px;" />
            </div>
            <div style="flex: 1;">
              <label style="font-size: 10px; color: var(--text-muted);">端点 1 对应数值:</label>
              <input type="number" id="inp-sc-origin-val" value="${t.originVal}" style="font-size: 11px;" />
            </div>
          </div>

          <!-- 物理数轴跨度指示器 -->
          <div style="margin: 6px 0; padding: 4px 6px; background: rgba(15, 23, 42, 0.5); border-radius: 4px; border: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; justify-content: space-between; font-size: 9.5px; font-family: var(--font-mono); color: var(--text-muted); margin-bottom: 2px;">
              <span style="color: #38bdf8;">基线: ${t.originVal}${t.unit||`%`} (X=${t.originX})</span>
              <span style="color: #f97316;">刻度: ${t.calibVal}${t.unit||`%`} (X=${t.calibX})</span>
            </div>
            <div style="position: relative; height: 5px; background: rgba(51, 65, 85, 0.6); border-radius: 3px; overflow: hidden;">
              <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: linear-gradient(90deg, #38bdf8, #f97316); opacity: 0.85;"></div>
            </div>
          </div>

          <!-- 端点 2: 真实刻度齿 -->
          <div style="display: flex; gap: 8px;">
            <div style="flex: 1;">
              <label style="font-size: 10px; color: #f97316;">端点 2 (刻度齿像素 X):</label>
              <input type="number" id="inp-sc-calib-x" value="${t.calibX}" style="font-size: 11px; border-color: rgba(249,115,22,0.4);" />
            </div>
            <div style="flex: 1;">
              <label style="font-size: 10px; color: #f97316;">端点 2 刻度齿数值:</label>
              <div class="input-row">
                <input type="number" id="inp-sc-calib-val" value="${t.calibVal}" style="font-size: 11px; border-color: rgba(249,115,22,0.4);" />
                <input type="text" id="inp-sc-unit" value="${t.unit||`%`}" style="width: 45px; font-size: 11px;" />
              </div>
            </div>
          </div>

          <!-- 常用刻度快捷填入胶囊 -->
          <div class="btn-group" style="margin-top: 8px; width: 100%; display: flex; gap: 4px;">
            <button class="tool-btn quick-tick-val-btn" data-val="100" style="flex:1; font-size: 10px;">齿:100%</button>
            <button class="tool-btn quick-tick-val-btn" data-val="50" style="flex:1; font-size: 10px;">齿:50%</button>
            <button class="tool-btn quick-tick-val-btn" data-val="20" style="flex:1; font-size: 10px;">齿:20%</button>
            <button class="tool-btn quick-tick-val-btn" data-val="10" style="flex:1; font-size: 10px;">齿:10%</button>
          </div>
        </div>

        <!-- 刻度尺度模式 (线性 Linear / 对数 Log) -->
        <div class="form-group" style="margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px;">刻度尺度 (Scale Type):</label>
            <span style="font-size: 10px; color: ${n===`log`?`#f59e0b`:`#38bdf8`}; font-weight: 600;">${n.toUpperCase()}</span>
          </div>
          <div class="btn-group" style="display: flex; gap: 4px; width: 100%; margin-top: 4px;">
            <button class="tool-btn quick-scaletype-btn ${n===`linear`?`active-mode`:``}" data-scale="linear" style="flex: 1; font-size: 10px;">线性 (Linear)</button>
            <button class="tool-btn quick-scaletype-btn ${n===`log`?`active-mode`:``}" data-scale="log" ${i?`style="flex: 1; font-size: 10px;"`:`disabled title="对数刻度要求: 起点值 > 0 且 刻度值 > 0" style="flex: 1; font-size: 10px; opacity: 0.45; cursor: not-allowed;"`}>对数 (Log)</button>
          </div>
          ${i?``:`
            <div id="log-scale-err" style="color: #ef4444; font-size: 10px; margin-top: 4px; line-height: 1.3;">
              ⚠️ ${r.reason}
            </div>
          `}
        </div>

        <!-- 图表形态选择 (面积图 / 柱状图 / 纯折线 / 散点符号) -->
        <div class="form-group" style="margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px;">图表形态类型 (Plot Type):</label>
            <button id="btn-apply-type-all" class="tool-btn" style="font-size: 9.5px; padding: 1px 5px; color: var(--text-muted);" title="将当前形态应用至全部属种列">应用至全列</button>
          </div>
          <div class="btn-group" style="display: flex; gap: 3px; width: 100%; margin-top: 4px;">
            <button class="tool-btn quick-plottype-btn ${(e.plotType||`area`)===`area`?`active-mode`:``}" data-type="area" style="flex: 1; font-size: 10.5px; padding: 4px 2px;">🌊 面积</button>
            <button class="tool-btn quick-plottype-btn ${e.plotType===`bar`?`active-mode`:``}" data-type="bar" style="flex: 1; font-size: 10.5px; padding: 4px 2px;">📊 柱状</button>
            <button class="tool-btn quick-plottype-btn ${e.plotType===`line`?`active-mode`:``}" data-type="line" style="flex: 1; font-size: 10.5px; padding: 4px 2px;">📈 折线</button>
            <button class="tool-btn quick-plottype-btn ${e.plotType===`symbol`?`active-mode`:``}" data-type="symbol" style="flex: 1; font-size: 10.5px; padding: 4px 2px;">➕ 符号</button>
          </div>
        </div>

        <!-- 局部放大曲线设置 (Exaggeration: 由用户负责填写图中标注的放大倍数) -->
        <div class="form-group" style="margin-top: 8px; padding: 6px 8px; background: rgba(148,163,184,0.06); border-radius: 4px; border: 1px dashed rgba(148,163,184,0.25);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px; display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0;">
              <input type="checkbox" id="chk-has-exag" ${e.hasExaggeration?`checked`:``} style="cursor: pointer;" />
              <span style="font-weight: 500;">局部放大曲线 (Exaggeration)</span>
            </label>
            <span style="font-size: 10px; color: #a855f7; font-weight: 600;">${e.hasExaggeration?`${e.exaggerationMult||5}× 启用`:`未勾选`}</span>
          </div>
          ${e.hasExaggeration?`
            <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 10px; color: #94a3b8;">放大倍数:</span>
              <input type="number" id="inp-exag-mult" value="${e.exaggerationMult||5}" min="1" max="100" style="width: 50px; font-size: 11px; padding: 2px 4px;" />
              <div class="btn-group" style="display: flex; gap: 2px; flex: 1;">
                <button class="tool-btn quick-exag-btn" data-exag="3" style="flex: 1; font-size: 9px; padding: 2px;">3×</button>
                <button class="tool-btn quick-exag-btn" data-exag="5" style="flex: 1; font-size: 9px; padding: 2px;">5×</button>
                <button class="tool-btn quick-exag-btn" data-exag="10" style="flex: 1; font-size: 9px; padding: 2px;">10×</button>
              </div>
            </div>
          `:``}
        </div>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button id="btn-col-digitize" class="btn btn-primary" style="flex: 1; font-size: 11px; padding: 6px;">
            ⚡ 重新识别此列
          </button>
          <button id="btn-col-delete" class="btn btn-secondary" style="color: #ef4444; border-color: rgba(239,68,68,0.4); font-size: 11px; padding: 6px;">
            🗑 删除列
          </button>
        </div>
      </div>
    `}renderPointInspector(e,t){let n=o.imageYToDepth(t.y,this.data.calibration),r=o.imageXToPercent(t.x,e),i={peak:{text:`物理极大值 (波峰)`,color:`#fbbf24`},trough:{text:`物理极小值 (波谷/基线)`,color:`#f59e0b`},manual:{text:`手工强控制锚点`,color:`#38bdf8`},transition:{text:`长坡过渡折线点`,color:`#94a3b8`}},a=i[t.type||`transition`]||i.transition;return`
      <div class="inspector-section">
        <div class="section-title">选中的控制拐点</div>
        <div class="property-grid">
          <div class="prop-row">
            <span class="prop-label">所属属种:</span>
            <span class="prop-val"><strong style="color: ${e.color};">${e.name}</strong></span>
          </div>
          <div class="prop-row">
            <span class="prop-label">控制点类型:</span>
            <span class="prop-val" style="color: ${a.color}; font-weight: 600;">${a.text}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">地层深度:</span>
            <span class="prop-val">${n===void 0?`--`:n.toFixed(2)} ${this.data.calibration.unit}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">物理丰度:</span>
            <span class="prop-val">${r===void 0?`--`:r.toFixed(2)}%</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">像素坐标:</span>
            <span class="prop-val">X:${Math.round(t.x)}, Y:${Math.round(t.y)}</span>
          </div>
        </div>

        <button id="btn-delete-point" class="btn btn-secondary" style="width: 100%; margin-top: 12px; color: #ef4444; border-color: rgba(239,68,68,0.4);">
          🗑 删除此控制锚点
        </button>
      </div>
    `}bindEvents(){this.element.querySelector(`#btn-collapse-inspector`)?.addEventListener(`click`,()=>{this.toggleCollapse()});let e=this.element.querySelector(`#inp-col-name`);e?.addEventListener(`change`,()=>{let t=this.data.columns.find(e=>e.id===this.data.activeTaxaId);if(t&&e.value.trim()){let n=t.name;t.name=e.value.trim(),this.history.push(`Rename Taxa ${n} to ${t.name}`,this.data.columns,this.data.activeTaxaId),this.callbacks.onDataChange()}});let t=()=>{let e=this.data.columns.find(e=>e.id===this.data.activeTaxaId);if(!e)return;let t=parseInt(this.element.querySelector(`#inp-sc-origin-x`)?.value,10),n=parseFloat(this.element.querySelector(`#inp-sc-origin-val`)?.value),r=parseInt(this.element.querySelector(`#inp-sc-calib-x`)?.value,10),i=parseFloat(this.element.querySelector(`#inp-sc-calib-val`)?.value),a=this.element.querySelector(`#inp-sc-unit`)?.value.trim()||`%`;!isNaN(t)&&!isNaN(r)&&!isNaN(i)&&r!==t&&(e.scaleCalib={originX:t,originVal:isNaN(n)?0:n,calibX:r,calibVal:i,unit:a},e.startX=t,e.startValue=isNaN(n)?0:n,e.unit=a,e.maxPercent=i,e.tickValue=i,e.tickEndX=r,e.isLocked=!0,e.scale_type===`log`&&(o.validateLogScale(e).valid||(e.scale_type=`linear`)),e.controlPoints&&e.controlPoints.forEach(t=>{t.value=o.imageXToValue(t.x,e)}),this.history.push(`Update Tick Calibration for ${e.name}`,this.data.columns,this.data.activeTaxaId),this.render(),this.callbacks.onDataChange())};this.element.querySelector(`#inp-sc-origin-x`)?.addEventListener(`change`,t),this.element.querySelector(`#inp-sc-origin-val`)?.addEventListener(`change`,t),this.element.querySelector(`#inp-sc-calib-x`)?.addEventListener(`change`,t),this.element.querySelector(`#inp-sc-calib-val`)?.addEventListener(`change`,t),this.element.querySelector(`#inp-sc-unit`)?.addEventListener(`change`,t),this.element.querySelectorAll(`.quick-tick-val-btn`).forEach(e=>{e.addEventListener(`click`,()=>{let n=parseFloat(e.getAttribute(`data-val`)||`20`),r=this.element.querySelector(`#inp-sc-calib-val`);r&&!isNaN(n)&&(r.value=String(n),t())})}),this.element.querySelectorAll(`.quick-scaletype-btn`).forEach(e=>{e.addEventListener(`click`,()=>{let t=e.getAttribute(`data-scale`),n=this.data.columns.find(e=>e.id===this.data.activeTaxaId);if(n&&t&&n.scale_type!==t){if(t===`log`){let e=o.validateLogScale(n);if(!e.valid){alert(`无法切换到对数刻度：\n${e.reason}`);return}}n.scale_type=t,n.controlPoints&&n.controlPoints.forEach(e=>{e.value=o.imageXToValue(e.x,n)}),this.history.push(`Switch ${n.name} scale to ${t}`,this.data.columns,this.data.activeTaxaId),this.render(),this.callbacks.onDataChange()}})}),this.element.querySelectorAll(`.quick-plottype-btn`).forEach(e=>{e.addEventListener(`click`,()=>{let t=e.getAttribute(`data-type`),n=this.data.columns.find(e=>e.id===this.data.activeTaxaId);n&&t&&(n.plotType=t,this.history.push(`Change ${n.name} Plot Type to ${t}`,this.data.columns,this.data.activeTaxaId),this.render(),this.callbacks.onDataChange())})}),this.element.querySelector(`#btn-apply-type-all`)?.addEventListener(`click`,()=>{let e=this.data.columns.find(e=>e.id===this.data.activeTaxaId);if(e){let t=e.plotType||`area`;this.data.columns.forEach(e=>{e.plotType=t}),this.history.push(`Apply Plot Type ${t} to All Columns`,this.data.columns,this.data.activeTaxaId),this.render(),this.callbacks.onDataChange()}}),this.element.querySelector(`#chk-has-exag`)?.addEventListener(`change`,e=>{let t=e.target.checked,n=this.data.columns.find(e=>e.id===this.data.activeTaxaId);n&&(n.hasExaggeration=t,t&&!n.exaggerationMult&&(n.exaggerationMult=5),this.history.push(`Toggle Exaggeration for ${n.name}`,this.data.columns,this.data.activeTaxaId),this.render(),this.callbacks.onDataChange())}),this.element.querySelector(`#inp-exag-mult`)?.addEventListener(`change`,e=>{let t=parseFloat(e.target.value),n=this.data.columns.find(e=>e.id===this.data.activeTaxaId);n&&!isNaN(t)&&t>=1&&(n.exaggerationMult=t,this.history.push(`Set Exaggeration to ${t}x for ${n.name}`,this.data.columns,this.data.activeTaxaId),this.render(),this.callbacks.onDataChange())}),this.element.querySelectorAll(`.quick-exag-btn`).forEach(e=>{e.addEventListener(`click`,()=>{let t=parseFloat(e.getAttribute(`data-exag`)||`5`),n=this.data.columns.find(e=>e.id===this.data.activeTaxaId);n&&!isNaN(t)&&(n.exaggerationMult=t,this.history.push(`Set Exaggeration to ${t}x for ${n.name}`,this.data.columns,this.data.activeTaxaId),this.render(),this.callbacks.onDataChange())})}),this.element.querySelector(`#btn-col-delete`)?.addEventListener(`click`,()=>{let e=this.data.columns.find(e=>e.id===this.data.activeTaxaId);if(e&&this.data.columns.length>1){let t=this.data.columns.findIndex(t=>t.id===e.id);t!==-1&&(this.data.columns.splice(t,1),this.data.activeTaxaId=this.data.columns[0]?.id||``,this.history.push(`Delete Column ${e.name}`,this.data.columns,this.data.activeTaxaId),this.callbacks.onDataChange(),this.callbacks.onSelectTaxa(this.data.activeTaxaId))}}),this.element.querySelector(`#btn-col-digitize`)?.addEventListener(`click`,()=>{this.callbacks.onDigitizeActiveColumn()}),this.element.querySelector(`#btn-delete-point`)?.addEventListener(`click`,()=>{let e=this.data.selectedEntity;if(e?.type===`point`){let t=this.data.columns.find(t=>t.id===e.colId),n=t?.controlPoints.find(t=>t.id===e.pointId);t&&n&&(new u(t.id,n,t.name).execute(this.data),this.data.selectedEntity=null,this.history.push(`Delete Anchor from ${t.name}`,this.data.columns,this.data.activeTaxaId),this.render(),this.callbacks.onDataChange())}}),this.element.querySelector(`#btn-apply-roi`)?.addEventListener(`click`,()=>{let e=parseInt(this.element.querySelector(`#inp-roi-xmin`).value,10),t=parseInt(this.element.querySelector(`#inp-roi-xmax`).value,10),n=parseInt(this.element.querySelector(`#inp-roi-ymin`).value,10),r=parseInt(this.element.querySelector(`#inp-roi-ymax`).value,10),i=parseFloat(this.element.querySelector(`#inp-roi-top`).value),a=parseFloat(this.element.querySelector(`#inp-roi-bot`).value),o=this.element.querySelector(`#inp-roi-unit`).value.trim()||`cm`,s={...this.data.calibration};new d(s,{...this.data.calibration,dataXMin:isNaN(e)?s.dataXMin:e,dataXMax:isNaN(t)?s.dataXMax:t,dataYMin:isNaN(n)?s.dataYMin:n,dataYMax:isNaN(r)?s.dataYMax:r,depthTopValue:isNaN(i)?s.depthTopValue:i,depthBottomValue:isNaN(a)?s.depthBottomValue:a,unit:o,isCalibrated:!0}).execute(this.data),this.history.push(`Update ROI & Calibration`,this.data.columns,this.data.activeTaxaId,this.data.calibration),this.callbacks.onDataChange()}),this.element.querySelector(`#layer-chk-ghost`)?.addEventListener(`change`,e=>{this.callbacks.onToggleLayerVisibility?.(`ghost`,e.target.checked)}),this.element.querySelector(`#btn-inspector-open-table`)?.addEventListener(`click`,()=>{this.callbacks.onOpenDataViewer?.()}),this.element.querySelector(`#btn-inspector-open-export`)?.addEventListener(`click`,()=>{this.callbacks.onOpenDataViewer?.()}),this.element.querySelector(`#select-inspector-degrid`)?.addEventListener(`change`,e=>{let t=e.target.value;this.callbacks.onChangeDegridStrength?.(t)})}},x=class{container;rpcClient;pollenData;onApplyAgeModel;modalEl=null;canvas=null;ctx=null;bgImage=null;inspectionData=null;showCurve=!0;showEnvelope=!0;showPollenHorizons=!0;overlayOpacity=.65;constructor(e,t,n,r){this.container=e,this.pollenData=t,this.rpcClient=n,this.onApplyAgeModel=r}open(){this.close();let e=document.createElement(`div`);e.className=`modal-backdrop`,e.innerHTML=`
      <div class="modal-dialog modal-large agedepth-dialog" style="width: min(1120px, 95vw); max-height: 92vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">⏳</span>
            <h3>年代-深度模型解译与视觉检查 (Age-Depth Visual Inspection)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #f59e0b, #ef4444); font-size: 10px; padding: 2px 6px;">贝叶斯年代学</span>
          </div>
          <button class="close-btn" id="ad-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; gap: 16px; padding: 14px; overflow: hidden;">
          <!-- 左侧: 交互式视觉检查 Canvas 视口 -->
          <div class="ad-viewport-pane" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
              <div style="display: flex; gap: 12px; align-items: center;">
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-curve" checked />
                  <span style="color: #38bdf8; font-weight: 600;">拟合代表线</span>
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-envelope" checked />
                  <span style="color: #f59e0b; font-weight: 600;">95% 置信带</span>
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-horizons" checked />
                  <span style="color: #34d399; font-weight: 600;">花粉层位交点</span>
                </label>
              </div>

              <div style="display: flex; align-items: center; gap: 6px;">
                <span>图层透明度:</span>
                <input type="range" id="ad-rng-opacity" min="0.1" max="1.0" step="0.05" value="0.65" style="width: 80px;" />
              </div>
            </div>

            <!-- Canvas 容器 -->
            <div id="ad-canvas-container" style="flex: 1; height: 420px; min-height: 360px; position: relative; background: #0b0f19; border: 2px dashed var(--border-color); border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; transition: border-color 0.2s;">
              <canvas id="ad-inspection-canvas" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; display: none;"></canvas>
              
              <!-- 醒目的空状态与上传引导区 (未载入图谱时直接呈现在画布中央) -->
              <div id="ad-empty-drop-zone" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(11, 15, 25, 0.94); z-index: 10; padding: 24px; text-align: center;">
                <div style="font-size: 44px; margin-bottom: 10px;">⏳</div>
                <h4 style="font-size: 15px; font-weight: 700; color: #f8fafc; margin: 0 0 6px 0;">请载入年代-深度模型图谱 (Age-Depth Diagram)</h4>
                <p style="font-size: 11.5px; color: var(--text-secondary); margin: 0 0 16px 0; max-width: 420px; line-height: 1.5;">
                  可直接将 <strong>Bacon / Bchron / Clam / OxCal</strong> 导出的年代曲线图拖拽至此处，或点击下方按钮选择文件。
                </p>
                <button id="ad-btn-center-browse" class="btn btn-primary" style="padding: 8px 24px; font-size: 12.5px; font-weight: 700; margin-bottom: 14px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                  </svg>
                  <span>📁 选择本地年代图文件 (PNG / JPG)</span>
                </button>
                <div style="display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--text-muted);">
                  <span>快速体验内置典型范例：</span>
                  <button id="ad-btn-center-bacon" class="tool-btn" style="padding: 3px 10px; font-size: 11px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">Hoya Bacon 贝叶斯图</button>
                  <button id="ad-btn-center-bchron" class="tool-btn" style="padding: 3px 10px; font-size: 11px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">Bchron 阶梯图</button>
                </div>
              </div>

              <div id="ad-canvas-hud" style="position: absolute; bottom: 8px; left: 8px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px); padding: 4px 8px; border-radius: 4px; font-size: 10.5px; font-family: var(--font-mono); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); pointer-events: none; z-index: 15;">
                悬停查验: 移动光标在年代曲线上即可实时测读深度与对应年代
              </div>
            </div>

            <div style="font-size: 10.5px; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between;">
              <span>💡 视觉检查标准：高亮蓝线应精确穿过深色脊线；琥珀色阴影应贴合灰色置信区间边缘。</span>
              <span id="ad-status-msg" style="color: #34d399;"></span>
            </div>
          </div>

          <!-- 右侧: 标定控制与花粉样品联动映射表 -->
          <div class="ad-control-pane" style="width: 320px; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 12px; border-radius: 6px; border: 1px solid var(--border-light); overflow-y: auto;">
            <!-- 年代图谱数据源 -->
            <div class="form-group" style="margin: 0; background: rgba(56, 189, 248, 0.05); padding: 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.2);">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
                <span>年代图谱数据源:</span>
                <span id="ad-current-source-label" style="font-size: 10px; color: #38bdf8;">未载入</span>
              </label>
              <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
                <button class="btn btn-primary" id="ad-btn-upload-file" style="width: 100%; font-size: 11.5px; padding: 6px 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                  </svg>
                  <span>📁 上传本地年代图 (PNG/JPG)</span>
                </button>
                <input type="file" id="ad-file-input" accept="image/png,image/jpeg,image/webp" style="display: none;" />

                <div style="display: flex; gap: 6px;">
                  <button class="tool-btn" id="ad-btn-load-bacon" style="flex: 1; font-size: 10.5px;">Bacon 范例</button>
                  <button class="tool-btn" id="ad-btn-load-bchron" style="flex: 1; font-size: 10.5px;">Bchron 范例</button>
                </div>
              </div>
            </div>

            <!-- 坐标轴物理标定 -->
            <div class="form-group" style="margin: 0; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
              <div style="font-size: 11px; font-weight: bold; color: #38bdf8; margin-bottom: 6px;">坐标轴标定 (Axes Calibration):</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10.5px;">
                <div>
                  <label style="color: var(--text-muted);">深度顶端 (Depth Top):</label>
                  <input type="number" id="ad-inp-depth-top" value="0" style="width: 100%; font-size: 11px;" />
                </div>
                <div>
                  <label style="color: var(--text-muted);">深度底端 (Depth Bottom):</label>
                  <input type="number" id="ad-inp-depth-bottom" value="150" style="width: 100%; font-size: 11px;" />
                </div>
                <div>
                  <label style="color: var(--text-muted);">年代左端 (Age Left):</label>
                  <input type="number" id="ad-inp-age-left" value="3000" style="width: 100%; font-size: 11px;" />
                </div>
                <div>
                  <label style="color: var(--text-muted);">年代右端 (Age Right):</label>
                  <input type="number" id="ad-inp-age-right" value="0" style="width: 100%; font-size: 11px;" />
                </div>
              </div>
            </div>

            <!-- 用户自定义元数据填报 -->
            <div class="form-group" style="margin: 0;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary);">附加科学元数据 (Metadata):</label>
              <div style="display: flex; flex-direction: column; gap: 5px; font-size: 10.5px; margin-top: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: var(--text-muted);">拟合线类型:</span>
                  <select id="ad-sel-curve-type" class="sample-select" style="width: 130px; font-size: 10.5px;">
                    <option value="median" selected>中位数 (Median)</option>
                    <option value="weighted_mean">加权均值 (Mean)</option>
                    <option value="best_fit">最佳拟合线 (Best-fit)</option>
                  </select>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: var(--text-muted);">置信区间类型:</span>
                  <select id="ad-sel-envelope-type" class="sample-select" style="width: 130px; font-size: 10.5px;">
                    <option value="95_hpd" selected>95% 最高后验 (2σ)</option>
                    <option value="68_ci">68% 置信区间 (1σ)</option>
                  </select>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: var(--text-muted);">年代单位与曲线:</span>
                  <div style="display: flex; gap: 4px;">
                    <input type="text" id="ad-inp-age-unit" value="cal BP" style="width: 65px; font-size: 10px;" />
                    <input type="text" id="ad-inp-cal-curve" value="IntCal20" style="width: 60px; font-size: 10px;" />
                  </div>
                </div>
              </div>
            </div>

            <!-- 执行识别与视觉核查按钮 -->
            <button class="btn btn-primary" id="ad-btn-extract" style="font-size: 11px; padding: 7px; background: linear-gradient(135deg, #0284c7, #38bdf8);">
              🔍 运行识别并叠加视觉检查
            </button>

            <!-- 花粉样品深度联动预览 -->
            <div class="form-group" style="margin: 0; flex: 1; display: flex; flex-direction: column;">
              <label style="font-size: 11px; font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">花粉样品年代映射预览:</label>
              <div id="ad-mapping-table-wrap" style="height: 110px; overflow: auto; border: 1px solid var(--border-light); border-radius: 4px; background: rgba(0,0,0,0.3); font-size: 10px; font-family: var(--font-mono);">
                <table style="width: 100%; border-collapse: collapse; text-align: right;">
                  <thead style="position: sticky; top: 0; background: #1e293b; color: #38bdf8;">
                    <tr>
                      <th style="padding: 2px 4px;">Depth</th>
                      <th style="padding: 2px 4px;">Age</th>
                      <th style="padding: 2px 4px;">95% CI</th>
                    </tr>
                  </thead>
                  <tbody id="ad-mapping-tbody">
                    <tr><td colspan="3" style="text-align: center; color: #64748b; padding: 12px;">尚未执行识别提取</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-top: 1px solid var(--border-color);">
          <div style="font-size: 10.5px; color: var(--text-muted);">
            通过视觉检查确认拟合贴合度后，点击应用可直接赋予当前花粉图谱真实年代轴。
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" id="ad-btn-cancel">取消</button>
            <button class="btn btn-primary" id="ad-btn-apply" style="background: linear-gradient(135deg, #059669, #10b981);">
              ✅ 确认无误，关联至花粉图谱
            </button>
          </div>
        </div>
      </div>
    `,this.container.appendChild(e),this.modalEl=e,this.canvas=e.querySelector(`#ad-inspection-canvas`),this.ctx=this.canvas.getContext(`2d`),e.querySelector(`#ad-close-btn`)?.addEventListener(`click`,()=>this.close()),e.querySelector(`#ad-btn-cancel`)?.addEventListener(`click`,()=>this.close());let t=e.querySelector(`#ad-chk-curve`),n=e.querySelector(`#ad-chk-envelope`),r=e.querySelector(`#ad-chk-horizons`),i=e.querySelector(`#ad-rng-opacity`);t?.addEventListener(`change`,()=>{this.showCurve=t.checked,this.renderCanvas()}),n?.addEventListener(`change`,()=>{this.showEnvelope=n.checked,this.renderCanvas()}),r?.addEventListener(`change`,()=>{this.showPollenHorizons=r.checked,this.renderCanvas()}),i?.addEventListener(`input`,()=>{this.overlayOpacity=parseFloat(i.value)||.65,this.renderCanvas()});let a=e.querySelector(`#ad-file-input`);e.querySelector(`#ad-btn-upload-file`)?.addEventListener(`click`,()=>{a?.click()}),e.querySelector(`#ad-btn-center-browse`)?.addEventListener(`click`,()=>{a?.click()}),a?.addEventListener(`change`,e=>{let t=e.target.files;t&&t[0]&&this.handleUploadFile(t[0])});let o=e.querySelector(`#ad-canvas-container`);o?.addEventListener(`dragover`,e=>{e.preventDefault(),o.style.borderColor=`#38bdf8`}),o?.addEventListener(`dragleave`,e=>{e.preventDefault(),o.style.borderColor=`var(--border-color)`}),o?.addEventListener(`drop`,e=>{e.preventDefault(),o.style.borderColor=`var(--border-color)`;let t=e.dataTransfer?.files;t&&t[0]&&this.handleUploadFile(t[0])}),e.querySelector(`#ad-btn-load-bacon`)?.addEventListener(`click`,()=>{e.querySelector(`#ad-inp-depth-top`).value=`0`,e.querySelector(`#ad-inp-depth-bottom`).value=`150`,e.querySelector(`#ad-inp-age-left`).value=`3000`,e.querySelector(`#ad-inp-age-right`).value=`0`,this.loadSampleImage(`bacon`)}),e.querySelector(`#ad-btn-center-bacon`)?.addEventListener(`click`,()=>{e.querySelector(`#ad-inp-depth-top`).value=`0`,e.querySelector(`#ad-inp-depth-bottom`).value=`150`,e.querySelector(`#ad-inp-age-left`).value=`3000`,e.querySelector(`#ad-inp-age-right`).value=`0`,this.loadSampleImage(`bacon`)}),e.querySelector(`#ad-btn-load-bchron`)?.addEventListener(`click`,()=>{e.querySelector(`#ad-inp-depth-top`).value=`0`,e.querySelector(`#ad-inp-depth-bottom`).value=`150`,e.querySelector(`#ad-inp-age-left`).value=`0`,e.querySelector(`#ad-inp-age-right`).value=`12000`,this.loadSampleImage(`bchron`)}),e.querySelector(`#ad-btn-center-bchron`)?.addEventListener(`click`,()=>{e.querySelector(`#ad-inp-depth-top`).value=`0`,e.querySelector(`#ad-inp-depth-bottom`).value=`150`,e.querySelector(`#ad-inp-age-left`).value=`0`,e.querySelector(`#ad-inp-age-right`).value=`12000`,this.loadSampleImage(`bchron`)}),e.querySelector(`#ad-btn-extract`)?.addEventListener(`click`,()=>this.executeExtraction()),e.querySelector(`#ad-btn-apply`)?.addEventListener(`click`,()=>{if(!this.inspectionData){alert(`请先点击运行识别并完成视觉检查！`);return}this.onApplyAgeModel(this.inspectionData),this.close()}),this.canvas.addEventListener(`mousemove`,e=>this.handleCanvasHover(e)),this.loadSampleImage(`bacon`)}close(){this.modalEl&&=(this.modalEl.remove(),null)}handleUploadFile(e){if(!e.type.startsWith(`image/`)){alert(`请上传有效的图片文件 (PNG/JPG/WebP)！`);return}let t=new FileReader;t.onload=async t=>{let n=t.target?.result;if(!n)return;let r=new Image;r.onload=async()=>{this.bgImage=r,this.canvas&&(this.canvas.width=r.naturalWidth,this.canvas.height=r.naturalHeight,this.canvas.style.display=`block`);let t=this.modalEl?.querySelector(`#ad-empty-drop-zone`);t&&(t.style.display=`none`);let i=this.modalEl?.querySelector(`#ad-current-source-label`);i&&(i.textContent=e.name);let a=this.modalEl?.querySelector(`#ad-status-msg`);a&&(a.textContent=`已载入用户图谱: ${e.name} (${r.naturalWidth}×${r.naturalHeight})`);try{await this.rpcClient.call(`agedepth.loadModelDiagram`,{base64_data:n})}catch(e){console.warn(`Backend loadModelDiagram via base64 fallback:`,e)}this.inspectionData=null,this.renderCanvas()},r.src=n},t.readAsDataURL(e)}loadSampleImage(e){let t=new Image;t.crossOrigin=`anonymous`,t.onload=()=>{this.bgImage=t,this.canvas&&(this.canvas.width=t.naturalWidth,this.canvas.height=t.naturalHeight,this.canvas.style.display=`block`);let n=this.modalEl?.querySelector(`#ad-empty-drop-zone`);n&&(n.style.display=`none`);let r=this.modalEl?.querySelector(`#ad-current-source-label`);r&&(r.textContent=e.toUpperCase()),this.inspectionData=null,this.renderCanvas();let i=this.modalEl?.querySelector(`#ad-status-msg`);i&&(i.textContent=`已载入内置范例: ${e.toUpperCase()}`)},t.src=`/image/agedepth?sample=${e}&t=${Date.now()}`}async executeExtraction(){if(!this.modalEl||!this.bgImage)return;let e=parseFloat(this.modalEl.querySelector(`#ad-inp-depth-top`).value)||0,t=parseFloat(this.modalEl.querySelector(`#ad-inp-depth-bottom`).value)||150,n=parseFloat(this.modalEl.querySelector(`#ad-inp-age-left`).value)||3e3,r=parseFloat(this.modalEl.querySelector(`#ad-inp-age-right`).value)||0,i=this.modalEl.querySelector(`#ad-sel-curve-type`).value,a=this.modalEl.querySelector(`#ad-sel-envelope-type`).value,o=this.modalEl.querySelector(`#ad-inp-age-unit`).value.trim()||`cal BP`,s=this.modalEl.querySelector(`#ad-inp-cal-curve`).value.trim()||`IntCal20`,c=this.bgImage.naturalWidth,l=this.bgImage.naturalHeight,u=await this.rpcClient.call(`agedepth.extractAndInspect`,{depth_px:[l*.04,l*.88],depth_vals:[e,t],age_px:[c*.13,c*.94],age_vals:[n,r],roi_box:[c*.11,l*.035,c*.96,l*.89],curve_type:i,envelope_type:a,depth_unit:`cm`,age_unit:o,cal_curve:s});if(u&&u.inspection){this.inspectionData=u.inspection,this.renderCanvas(),this.updateMappingTable();let e=this.modalEl.querySelector(`#ad-status-msg`);e&&(e.textContent=`✅ 识别成功！已叠加高精度拟合线与置信带`)}}renderCanvas(){if(!this.ctx||!this.canvas||!this.bgImage)return;let e=this.ctx,t=this.canvas.width,n=this.canvas.height;if(e.clearRect(0,0,t,n),e.drawImage(this.bgImage,0,0,t,n),!this.inspectionData||!this.inspectionData.px_points)return;let r=this.inspectionData.px_points,i=r.y.length;if(!(i<2)){if(e.save(),this.showEnvelope&&r.x_min&&r.x_max){e.beginPath();for(let t=0;t<i;t++){let n=r.x_min[t],i=r.y[t];t===0?e.moveTo(n,i):e.lineTo(n,i)}for(let t=i-1;t>=0;t--){let n=r.x_max[t],i=r.y[t];e.lineTo(n,i)}e.closePath(),e.fillStyle=`rgba(245, 158, 11, ${this.overlayOpacity*.45})`,e.fill(),e.strokeStyle=`rgba(245, 158, 11, ${this.overlayOpacity*.9})`,e.lineWidth=1.5,e.setLineDash([4,3]),e.stroke(),e.setLineDash([])}if(this.showCurve&&r.x_curve){e.beginPath();for(let t=0;t<i;t++){let n=r.x_curve[t],i=r.y[t];t===0?e.moveTo(n,i):e.lineTo(n,i)}e.strokeStyle=`rgba(56, 189, 248, ${this.overlayOpacity*.4})`,e.lineWidth=6,e.stroke(),e.strokeStyle=`rgba(2, 132, 199, ${Math.min(1,this.overlayOpacity+.35)})`,e.lineWidth=2.2,e.stroke()}if(this.showPollenHorizons&&this.pollenData.calibration){let i=this.pollenData.calibration.depthTopValue,a=this.pollenData.calibration.depthBottomValue,o=this.pollenData.calibration.depthInterval||5,s=[];for(let e=i;e<=a;e+=o)s.push(e);e.fillStyle=`#10b981`,e.strokeStyle=`#059669`,e.lineWidth=1,s.forEach(o=>{let s=a-i;if(s>0&&r.y&&r.x_curve){let a=(o-i)/s,c=n*.04+n*.84*a,l=0,u=9999;for(let e=0;e<r.y.length;e++){let t=Math.abs(r.y[e]-c);t<u&&(u=t,l=e)}let d=r.x_curve[l];u<30&&(e.beginPath(),e.strokeStyle=`rgba(52, 211, 153, 0.35)`,e.setLineDash([3,3]),e.moveTo(t*.11,c),e.lineTo(d,c),e.stroke(),e.setLineDash([]),e.beginPath(),e.fillStyle=`#34d399`,e.strokeStyle=`#059669`,e.lineWidth=1.5,e.arc(d,c,3.5,0,Math.PI*2),e.fill(),e.stroke())}})}e.restore()}}handleCanvasHover(e){if(!this.canvas||!this.inspectionData||!this.inspectionData.px_points)return;let t=this.canvas.getBoundingClientRect(),n=this.canvas.height/t.height,r=(e.clientY-t.top)*n,i=this.modalEl?.querySelector(`#ad-canvas-hud`);if(!i)return;let a=this.inspectionData.px_points,o=-1,s=9999;for(let e=0;e<a.y.length;e++){let t=Math.abs(a.y[e]-r);t<s&&(s=t,o=e)}if(o!==-1&&s<30){let e=this.inspectionData.depths[o],t=this.inspectionData.ages[o],n=this.inspectionData.age_min[o],r=this.inspectionData.age_max[o],a=this.inspectionData.metadata;i.innerHTML=`
        <span style="color: #38bdf8; font-weight: bold;">层位: ${e} ${a.depth_unit}</span>
        &nbsp;&rarr;&nbsp;
        <span style="color: #34d399; font-weight: bold;">年代 (${a.curve_type}): ${t} ${a.age_unit}</span>
        &nbsp;<span style="color: #f59e0b;">[95% CI: ${n} - ${r}]</span>
      `}}updateMappingTable(){let e=this.modalEl?.querySelector(`#ad-mapping-tbody`);if(!e||!this.inspectionData)return;e.innerHTML=``;let t=Math.min(25,this.inspectionData.depths.length),n=Math.max(1,Math.floor(this.inspectionData.depths.length/t));for(let t=0;t<this.inspectionData.depths.length;t+=n){let n=document.createElement(`tr`);n.style.borderBottom=`1px solid rgba(255,255,255,0.05)`,n.innerHTML=`
        <td style="padding: 2px 4px; color: #38bdf8;">${this.inspectionData.depths[t]}</td>
        <td style="padding: 2px 4px; color: #f1f5f9; font-weight: 600;">${this.inspectionData.ages[t]}</td>
        <td style="padding: 2px 4px; color: #f59e0b;">${this.inspectionData.age_min[t]}-${this.inspectionData.age_max[t]}</td>
      `,e.appendChild(n)}}};async function S(){let e=document.getElementById(`app`);if(!e)throw Error(`Missing #app container`);let t=new n;await t.probeBackend();let i=await t.getDiagramData(),a=new r(500);a.reset(i.columns,i.activeTaxaId);let o=`straditize_autosave_draft_v2`,c=null;function l(){c&&clearTimeout(c),c=window.setTimeout(()=>{try{let e={timestamp:Date.now(),data:M.data};localStorage.setItem(o,JSON.stringify(e))}catch{}},1e3)}window.addEventListener(`beforeunload`,e=>{a.canUndo()&&(e.preventDefault(),e.returnValue=`您有未保存的地学数字化工程修改，确定离开吗？`)});let u=null,d=null,m=null,g=document.createElement(`main`);g.className=`app-workspace`;let v=document.createElement(`div`);v.className=`canvas-wrapper`;let S=document.createElement(`div`);S.className=`drawer-toggle-tab left-tab`,S.title=`展开属种分列清单 (快捷键: [)`,S.innerHTML=`<span>›</span><span>属种清单</span>`,S.style.display=`none`,g.appendChild(S);let C=document.createElement(`div`);C.className=`drawer-toggle-tab right-tab`,C.title=`展开属性检查器 (快捷键: ])`,C.innerHTML=`<span>‹</span><span>属性检查器</span>`,C.style.display=`none`,g.appendChild(C);function w(e){u&&u.setCollapsed(e),S.style.display=e?`flex`:`none`,m&&m.setSidebarActive(!e),A(e?`属种分列列表已收起 (可点击左边缘把手或按 [ 键展开)`:`属种分列列表已展开`,2e3),M.handleResize()}function T(e){d&&d.setCollapsed(e),C.style.display=e?`flex`:`none`,m&&m.setInspectorActive(!e),A(e?`属性检查器已收起 (点击右边缘把手或顶栏 [属性 ☷] 即可展开)`:`属性检查器已展开`,2500),M.handleResize()}function E(){w(!u?.getIsCollapsed())}function D(){T(!d?.getIsCollapsed())}S.addEventListener(`click`,()=>w(!1)),C.addEventListener(`click`,()=>T(!1));let O=document.createElement(`div`);O.className=`canvas-hud`,O.innerHTML=`
    <span class="hud-dot"></span>
    <span id="hud-text">就绪：单击左键添加锚点拉伸轮廓 | 拖拽微调 | 右键删点 | 按 B 键即时透视二值化墨迹</span>
  `,v.appendChild(O);let k=null;function A(e,t=3e3){let n=document.getElementById(`hud-text`);n&&(n.textContent=e,k&&clearTimeout(k),k=window.setTimeout(()=>{n.textContent=`就绪：单击左键添加锚点拉伸轮廓 | 拖拽微调 | 右键删点 | 按 B 键即时透视二值化墨迹`,k=null},t))}let j=document.createElement(`footer`);j.className=`app-footer`,j.innerHTML=`
    <div class="footer-left">
      <div class="footer-item" id="footer-dimensions">图像: <code>${i.imageWidth}×${i.imageHeight}</code></div>
      <div class="footer-item" id="footer-zoom">缩放: <code>100%</code></div>
      <div class="footer-item" id="footer-cursor">光标: <code>--</code></div>
      <div class="footer-item" id="footer-depth">深度: <code>--</code></div>
      <div class="footer-item" id="footer-pollen">丰度: <code>--</code></div>
      <div class="footer-item" id="footer-tool-mode">模式: <strong>选择 (V)</strong></div>
    </div>
    <div class="footer-right">
      <div class="footer-item" id="footer-active-taxa">当前属种: <strong>--</strong></div>
      <div class="footer-item" id="footer-anchors">锚点: <code>--</code></div>
    </div>
  `;let M=new f(v,i,a,{onTaxaChange:e=>{u?.updateData(M.data),d?.updateData(M.data),V()},onDataChange:()=>{u?.updateData(M.data),d?.updateData(M.data),m?.updateHistoryState(),V(),l()},onHoverInfo:e=>{let t=document.getElementById(`footer-cursor`),n=document.getElementById(`footer-depth`),r=document.getElementById(`footer-pollen`);if(e){if(t&&(t.innerHTML=`坐标: <code>X:${e.worldX} Y:${e.worldY}</code>`),n){let t=M.data.calibration.unit;n.innerHTML=e.horizonDepth!==void 0&&e.horizonDepth!==null?`深度: <code>${e.depth===void 0?`--`:e.depth+` `+t}</code> <strong style="color: #38bdf8; margin-left: 6px;">[层位: ${e.horizonDepth} ${t}]</strong>`:`深度: <code>${e.depth===void 0?`--`:e.depth+` `+t}</code>`}r&&(r.innerHTML=`丰度: <code>${e.percent===void 0?`--`:e.percent+`%`}</code>`)}},onFilterChange:(e,t)=>{m?.updateFilterState(e,t)},onDropFile:e=>{R(e)},onStatusNotice:e=>{A(e,2500)},onOpenCalibration:()=>{L.openCalibrationModal()},onOpenFileDialog:()=>{document.getElementById(`file-input-image`)?.click()}}),N=M.data.columns.length>0?3:1;M.setWorkflowStage(N);let P=document.createElement(`div`);P.className=`workflow-action-bar`,P.style.cssText=`
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 95;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 16px;
    max-width: calc(100% - 40px);
    width: max-content;
    box-sizing: border-box;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid ${s.color.border.focus};
    border-radius: ${s.radius.full}px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.65);
    font-size: 11px;
    color: ${s.color.text.primary};
    pointer-events: auto;
  `,v.appendChild(P);function F(){let e=p[N];M.setWorkflowStage(N),m!==void 0&&m&&m.setWorkflowStep(N),d!==void 0&&d&&d.setWorkflowStage(N),P.innerHTML=`
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
        <span style="background: ${s.color.column.activeBadge}; color: #fff; font-weight: 700; font-size: 10px; padding: 2px 7px; border-radius: 9999px; flex-shrink: 0;">S${N}</span>
        <strong style="color: ${s.color.text.accent}; flex-shrink: 0;">${e.stepName}</strong>
        <span style="color: ${s.color.text.secondary}; font-size: 11px; max-width: 320px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${e.guideText}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        ${N>1?`<button id="btn-wf-prev" class="tool-btn" style="padding: 3px 8px; font-size: 10px;">↺ 上一步</button>`:``}
        ${e.primaryActionLabel?`<button id="btn-wf-next" class="btn btn-primary" style="padding: 4px 10px; font-size: 10.5px; font-weight: 600; white-space: nowrap;">${e.primaryActionLabel}</button>`:``}
      </div>
    `,P.querySelector(`#btn-wf-prev`)?.addEventListener(`click`,()=>{N>1&&(--N,F())}),P.querySelector(`#btn-wf-next`)?.addEventListener(`click`,async()=>{if(N===0)document.getElementById(`file-input-image`)?.click();else if(N===1)N=2,F(),A(`✅ 数据有效区 (ROI) 已锁定！可在此阶段开启图像去横线并按 B 键预览，满意后进入分列。`,4500);else if(N===2){A(`正在基于纯数据有效区推导各花粉属种垂直基线...`,5e3);let e=M.data.calibration,n=await t.detectColumnsInRoi({x0:e.dataXMin,x1:e.dataXMax,y0:e.dataYMin,y1:e.dataYMax});N=3,u?.updateData(M.data),d?.updateData(M.data),F(),V(),A(`✅ 成功切分 ${n.length} 个属种列！请在侧边栏核对名单或使用 ▲/▼ 对调顺位。`,4e3)}else if(N===3)N=4,F(),A(`👉 请在右侧属性检查器核查或微调两点式深度标尺与各列物理刻度齿。`,4e3);else if(N===4){A(`正在提取各列花粉多边形轮廓与显著控制手柄...`,8e3);let e=M.data.columns;for(let n of e){let e=await t.digitizeColumn(n.id);e.length>0&&(n.controlPoints=e)}N=5,u?.updateData(M.data),d?.updateData(M.data),F(),V(),A(`✅ 数字化完成！绿色半透明逆向对比层已开启，可直接在画布拖拽控制点微调。`,4500)}else N===5?(N=6,F(),L.openExportModal(),A(`🔍 已进入地学校验阶段：正在核验 100% 丰度总和自检门禁。`,4e3)):N===6?(N=7,F(),L.openExportModal()):N===7&&L.openExportModal()})}u=new _(M.data,{onSelectTaxa:e=>{M.setActiveTaxa(e),V()},onToggleVisible:e=>{let t=M.data.columns.find(t=>t.id===e);t&&(t.visible=!t.visible,M.requestRender(),u?.updateData(M.data))},onChangeCurveType:(e,t)=>{let n=M.data.columns.find(t=>t.id===e);n&&(n.curveType=t,a.push(`Change Curve Type to ${t}`,M.data.columns,M.data.activeTaxaId),M.requestRender(),u?.updateData(M.data))},onUpdateTaxaColor:(e,t)=>{let n=M.data.columns.find(t=>t.id===e);n&&(n.color=t,M.requestRender(),u?.updateData(M.data))},onBatchImportTaxa:e=>{M.batchUpdateTaxa(e),u?.updateData(M.data),m?.updateHistoryState(),V(),l(),A(`✅ 成功批量导入 ${e.length} 个属种名单并完成自动拓展对齐！`,3500)},onSwapTaxaNames:(e,t)=>{let n=M.data.columns;if(e>=0&&e<n.length&&t>=0&&t<n.length){let r=n[e].name;n[e].name=n[t].name,n[t].name=r,a.push(`Swap Taxa Names (${n[e].name} <-> ${n[t].name})`,n,M.data.activeTaxaId),u?.updateData(M.data),d?.updateData(M.data),m?.updateHistoryState(),V(),l(),A(`🔀 已对调属种顺位: ${n[e].name} 与 ${n[t].name}`)}},onInsertGapColumn:e=>{let t=M.data.columns,n=t.findIndex(t=>t.id===e),r=n===-1?t.length:n+1,i=n===-1?t[t.length-1]:t[n],o=i?i.endX:M.data.calibration.dataXMin,s=i?i.endX-i.startX:60,c={id:`col_${Date.now()}_gap`,name:`Gap_Col_${r+1}`,color:`#94a3b8`,startX:o,endX:o+s,maxPercent:20,tickEndX:o+s,unit:`%`,isLocked:!1,curveType:`linear`,visible:!0,controlPoints:[],scale_type:`linear`,startValue:0,tickValue:20,plotType:`area`};t.splice(r,0,c),M.data.activeTaxaId=c.id,a.push(`Insert Gap Column at ${r+1}`,t,c.id),M.requestRender(),u?.updateData(M.data),d?.updateData(M.data),m?.updateHistoryState(),V(),l(),A(`➕ 已插入空缺占位列 [Gap_Col_${r+1}]，后续属种名字已顺延后推！`,4e3)}});let I=new x(document.body,M.data,t,e=>{A(`✅ 成功关联年代模型 [${e.metadata.curve_type||`Median`}]！导出时将自动注入日历年代与 95% 置信区间。`,4e3)}),L=new y(document.body,M.data,t,e=>{M.data.calibration=e,a.push(`Update Calibration`,M.data.columns,M.data.activeTaxaId),M.requestRender(),d?.updateData(M.data),V()},e=>{M.loadNewDiagram(e),a.reset(e.columns,e.activeTaxaId),N=3,F(),u?.updateData(M.data),d?.updateData(M.data),m?.updateHistoryState(),m?.updateScale(M.viewport.scale),V(),A(`✅ 成功载入 Straditize 科学项目包 (.tar)！已 100% 还原全部属种、刻度钉与控制点。`,4500)});d=new b(M.data,a,{onDataChange:()=>{M.requestRender(),u?.updateData(M.data),m?.updateHistoryState(),V()},onSelectTaxa:e=>{M.setActiveTaxa(e),u?.updateData(M.data),V()},onToggleCollapse:e=>{T(e)},onDigitizeActiveColumn:async()=>{let e=M.getActiveColumn();if(!e)return;let n=await t.digitizeColumn(e.id);n.length>0&&(e.controlPoints=n,a.push(`Re-digitize ${e.name}`,M.data.columns,M.data.activeTaxaId),M.requestRender(),u?.updateData(M.data),d?.updateData(M.data),A(`⚡ 属种 ${e.name} 轮廓已根据图像算法完成重识别！`))},onOpenDataViewer:()=>{L.openExportModal()},onToggleLayerVisibility:(e,t)=>{e===`ghost`&&(M.viewport.showGhosting=t,M.requestRender(),A(t?`🟢 绿色原位半透明对比层已开启`:`绿色对比层已关闭`))},onChangeDegridStrength:e=>{M.setDegridStrength(e),A(`去网格横线灵敏度设为: ${e.toUpperCase()} (按 B 键透视查看红色切除预览)`)}});async function R(e){let n=e.name.toLowerCase();if(n.endsWith(`.tar`)||n.endsWith(`.json`)||n.endsWith(`.tar.gz`)){L.openProjectFile(e);return}if(!e.type.startsWith(`image/`)){A(`请选择或拖入有效的图片文件或项目文件 (.tar / .json)`);return}if(a.canUndo()&&!window.confirm(`当前项目有未保存修改，重新加载图片将清空当前工作区。是否继续？`))return;A(`正在载入地质图谱: ${e.name}...`,8e3);let r=new FileReader;r.onload=async n=>{let r=n.target?.result;if(!r)return;let i=new Image;i.onload=async()=>{let n=i.naturalWidth,o=i.naturalHeight,s=8e3,c=12e3;if(n>s||o>c){if(!window.confirm(`【图像尺寸过大提示】\n当前图像尺寸为 ${n}×${o} px，超过建议最大限制 (${s}×${c} px)。\n直接加载可能会耗尽浏览器内存导致崩溃。\n\n点击【确定】以 50% 降采样安全加载 (${Math.round(n/2)}×${Math.round(o/2)} px)；\n点击【取消】中止加载。`)){A(`已取消加载超限大图`);return}let e=z(i,.5);r=e.dataUrl,n=e.w,o=e.h}else n>=6e3&&o>=9e3&&A(`提示: 图像尺寸较大 (${n}×${o} px)，建议在充足内存环境下操作。`,4e3);let l=await t.loadCustomImage(r,n,o,e.name);M.loadNewDiagram(l),a.reset([],``),N=1,F(),u?.updateData(M.data),m?.updateHistoryState(),m?.updateScale(M.viewport.scale),m?.updateFilterState(M.viewport.imageMode,M.viewport.showBinaryOverlay),V(),A(`✅ 成功载入图谱 [${e.name}] (${n}×${o})！请在画布上调整数据有效区 (Step 1)，随后点击下方推进。`,5e3),t.detectDeskew().then(e=>{if(e&&e.has_skew&&Math.abs(e.suggested_rotation_angle)>=.3){let n=e.suggested_rotation_angle,r=document.createElement(`div`);r.className=`deskew-notice-banner`,r.style.cssText=`position: fixed; top: 52px; right: 20px; z-index: 9999;`,r.innerHTML=`
              <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid #f59e0b; border-radius: 6px; padding: 8px 14px; display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); font-size: 11px; color: #f8fafc;">
                <span>📐 <strong>图谱微斜提示</strong>: 检测到主轴倾斜约 <strong>${n>0?`+`:``}${n}°</strong>，是否自动水平矫正？</span>
                <div style="display: flex; gap: 6px;">
                  <button id="btn-deskew-apply" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px; background: #f59e0b; border-color: #f59e0b;">旋转校正</button>
                  <button id="btn-deskew-ignore" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">忽略</button>
                </div>
              </div>
            `,document.body.appendChild(r),r.querySelector(`#btn-deskew-apply`)?.addEventListener(`click`,async()=>{r.remove(),A(`正在旋转矫正图谱 (${n}°)...`,5e3);let e=await t.rotateImage(n);if(e&&e.success){let e=await t.getDiagramData();M.loadNewDiagram(e),a.reset([],``),N=1,F(),A(`✅ 已水平矫正图谱！有效区已重置。`,3500)}}),r.querySelector(`#btn-deskew-ignore`)?.addEventListener(`click`,()=>{r.remove()})}})},i.src=r},r.readAsDataURL(e)}function z(e,t=.5){let n=Math.round(e.naturalWidth*t),r=Math.round(e.naturalHeight*t),i=document.createElement(`canvas`);i.width=n,i.height=r;let a=i.getContext(`2d`);return a&&(a.imageSmoothingEnabled=!0,a.imageSmoothingQuality=`high`,a.drawImage(e,0,0,n,r)),{dataUrl:i.toDataURL(`image/png`),w:n,h:r}}async function B(e){A(`正在切换内置范例图谱: ${e}...`,5e3);let n=await t.loadSampleDiagram(e);M.loadNewDiagram(n),a.reset(n.columns,n.activeTaxaId),N=3,F(),u?.updateData(M.data),m?.updateHistoryState(),m?.updateScale(M.viewport.scale),m?.updateFilterState(M.viewport.imageMode,M.viewport.showBinaryOverlay),V(),A(`✅ 已载入范例: ${{hoya:`Hoya del Castillo 花粉剖面`,verification:`标定验证地质图谱`,beginner:`初学者沉积图谱`}[e]||e}，已自动居中重置！`,3500)}m=new h(a,t.getStatus(),{onFit:()=>{M.fitToScreen(),m?.updateScale(M.viewport.scale)},onReset100:()=>{M.resetZoom100(),m?.updateScale(M.viewport.scale)},onZoomIn:()=>{let e=M.canvas.getBoundingClientRect();M.viewport.zoomAt({x:e.width/2,y:e.height/2},1.25),M.requestRender(),m?.updateScale(M.viewport.scale)},onZoomOut:()=>{let e=M.canvas.getBoundingClientRect();M.viewport.zoomAt({x:e.width/2,y:e.height/2},.8),M.requestRender(),m?.updateScale(M.viewport.scale)},onUndo:()=>{let e=a.undo();e&&(M.data.columns=e.columns,M.data.activeTaxaId=e.activeTaxaId,M.requestRender(),u?.updateData(M.data),m?.updateHistoryState())},onRedo:()=>{let e=a.redo();e&&(M.data.columns=e.columns,M.data.activeTaxaId=e.activeTaxaId,M.requestRender(),u?.updateData(M.data),m?.updateHistoryState())},onDigitize:async()=>{let e=M.getActiveColumn();if(!e)return;let n=await t.digitizeColumn(e.id);n.length>0&&(e.controlPoints=n,a.push(`Re-digitize ${e.name}`,M.data.columns,M.data.activeTaxaId),M.requestRender(),u?.updateData(M.data))},onExport:async e=>{let n=await t.exportData(e);L.openExportModal(n,e)},onSaveProject:()=>{L.saveProjectFile(),A(`💾 数字化项目已打包导出为标准归档包 (.tar)！`,3500)},onOpenProjectFile:e=>{L.openProjectFile(e)},onOpenCalibrationModal:()=>{L.openCalibrationModal()},onOpenAgeDepthModal:()=>{I.open()},onToggleRpcConfig:()=>{L.openRpcConfigModal(()=>{m.updateStatus(t.getStatus())})},onOpenFile:e=>{R(e)},onLoadSample:e=>{B(e)},onChangeImageMode:e=>{M.viewport.imageMode=e,M.requestRender(),m?.updateFilterState(e,M.viewport.showBinaryOverlay),A(`底图滤镜模式切换为: ${e}`)},onToggleBinaryOverlay:()=>{let e=M.viewport.toggleBinaryOverlay();M.requestRender(),m?.updateFilterState(M.viewport.imageMode,e),A(e?`透视遮罩: 墨迹高亮模式 [开启] (青蓝=保留花粉，红=切除横线，快捷键 B)`:`透视遮罩: [关闭]`)},onChangeDegridStrength:e=>{M.setDegridStrength(e),A(`去网格横线灵敏度设为: ${e.toUpperCase()} (按 B 键透视查看红色切除预览)`)},onSelectToolMode:e=>{M.setToolMode(e),m.setToolMode(e);let t=M.toolModeManager.getToolDescription(e),n=document.getElementById(`footer-tool-mode`);n&&(n.innerHTML=`模式: <strong>${t.name} (${t.shortcut})</strong>`),A(`工具模式切换: ${t.name} (${t.shortcut}) - ${t.hint}`)},onToggleSidebar:()=>{E()},onToggleInspector:()=>{D()},onStepClick:e=>{N=e,F();let t=p[N];A(`切换至步骤 ${e}: ${t.stepName} - ${t.title}`)}}),(t.getStatus().isDesktopMode??i.isDesktopMode)&&m.setDesktopMode(!0),g.appendChild(u.getElement()),g.appendChild(v),g.appendChild(d.getElement()),e.appendChild(m.getElement()),e.appendChild(g),e.appendChild(j),F(),window.addEventListener(`keydown`,e=>{let t=e.target;t?.tagName!==`INPUT`&&t?.tagName!==`TEXTAREA`&&(e.key===`[`&&!e.ctrlKey&&!e.metaKey?(e.preventDefault(),E()):e.key===`]`&&!e.ctrlKey&&!e.metaKey&&(e.preventDefault(),D()))});function V(){let e=M.getActiveColumn(),t=document.getElementById(`footer-active-taxa`),n=document.getElementById(`footer-anchors`),r=document.getElementById(`footer-dimensions`),i=document.getElementById(`footer-zoom`);r&&(r.innerHTML=`图像: <code>${M.data.imageWidth}×${M.data.imageHeight}</code>`),i&&(i.innerHTML=`缩放: <code>${Math.round(M.viewport.scale*100)}%</code>`),e&&t&&(t.innerHTML=`当前属种: <span style="color: ${e.color};">●</span> <strong>${e.name}</strong>`),e&&n&&(n.innerHTML=`锚点数: <code>${e.controlPoints.filter(e=>e.isManual).length} 手动 / ${e.controlPoints.length} 总计</code>`)}M.canvas.addEventListener(`wheel`,()=>{m?.updateScale(M.viewport.scale)}),window.addEventListener(`resize`,()=>{M.handleResize()}),requestAnimationFrame(()=>{M.handleResize(),M.fitToScreen(),m?.updateScale(M.viewport.scale)}),V(),m?.updateScale(M.viewport.scale),m?.updateFilterState(M.viewport.imageMode,M.viewport.showBinaryOverlay);try{let e=localStorage.getItem(o);if(e){let t=JSON.parse(e);if(t&&t.data&&Array.isArray(t.data.columns)&&t.data.columns.length>0&&Date.now()-t.timestamp<6048e5){let e=new Date(t.timestamp).toLocaleTimeString(),n=document.createElement(`div`);n.className=`draft-recovery-banner`,n.style.cssText=`position: fixed; top: 48px; left: 50%; transform: translateX(-50%); z-index: 9999;`,n.innerHTML=`
          <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid #38bdf8; border-radius: 6px; padding: 7px 14px; display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 18px rgba(0,0,0,0.5); font-size: 11px; color: #f8fafc;">
            <span>📋 发现上次未保存的草稿 (${e}, 含 ${t.data.columns.length} 个属种列)</span>
            <div style="display: flex; gap: 6px;">
              <button id="btn-restore-draft" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px;">恢复草稿</button>
              <button id="btn-discard-draft" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">忽略</button>
            </div>
          </div>
        `,document.body.appendChild(n),n.querySelector(`#btn-restore-draft`)?.addEventListener(`click`,()=>{M.loadNewDiagram(t.data),a.reset(t.data.columns,t.data.activeTaxaId),u?.updateData(M.data),d?.updateData(M.data),m?.updateHistoryState(),V(),n.remove(),A(`✅ 成功恢复上次自动暂存的项目草稿！`,3500)}),n.querySelector(`#btn-discard-draft`)?.addEventListener(`click`,()=>{localStorage.removeItem(o),n.remove()})}}}catch{}console.log(`Straditize Modern Frontend Initialized Successfully`)}window.addEventListener(`DOMContentLoaded`,()=>{S().catch(e=>{console.error(`Failed to bootstrap Straditize frontend:`,e)})});
//# sourceMappingURL=index-ldQq3r9W.js.map