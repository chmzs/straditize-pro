import { ControlPoint, DiagramCalibration, DiagramData, TaxaColumn } from '../types/pollen';

export class MockBackend {
  private static generatePoints(
    baseX: number,
    width: number,
    yStart: number,
    yEnd: number,
    profile: number[]
  ): ControlPoint[] {
    const points: ControlPoint[] = [];
    const steps = profile.length - 1;
    const yStep = (yEnd - yStart) / Math.max(1, steps);

    for (let i = 0; i <= steps; i++) {
      const curY = Math.round(yStart + i * yStep);
      const factor = profile[i] ?? 0.2;
      const curX = Math.round(baseX + width * factor);
      points.push({
        id: `pt_${Math.random().toString(36).substring(2, 9)}`,
        x: curX,
        y: curY,
        type: i % 4 === 0 ? 'manual' : 'transition',
        isManual: i % 4 === 0,
        createdAt: Date.now() - (steps - i) * 1000,
      });
    }
    return points;
  }

  public static createDefaultDiagramData(): DiagramData {
    return this.getHoyaDiagramData();
  }

  public static getHoyaDiagramData(): DiagramData {
    const calibration: DiagramCalibration = {
      dataXMin: 315,
      dataXMax: 1946,
      dataYMin: 511,
      dataYMax: 1311,
      depthTopValue: 0,
      depthBottomValue: 450,
      unit: 'cm',
      isCalibrated: true,
      depthInterval: 10,
      depthGridEnabled: true,
    };

    const columns: TaxaColumn[] = [
      {
        id: "taxa_0",
        name: "Charcoal",
        color: "#38bdf8",
        startX: 319,
        endX: 497,
        maxPercent: 100,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_0_0", "x": 321, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_0_2", "x": 330, "y": 513, "type": "transition", "isManual": false, "createdAt": 1700000000002}, {"id": "pt_0_302", "x": 332, "y": 813, "type": "transition", "isManual": false, "createdAt": 1700000000302}, {"id": "pt_0_307", "x": 497, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_0_309", "x": 338, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_0_323", "x": 350, "y": 834, "type": "transition", "isManual": false, "createdAt": 1700000000323}, {"id": "pt_0_368", "x": 433, "y": 879, "type": "transition", "isManual": false, "createdAt": 1700000000368}, {"id": "pt_0_408", "x": 408, "y": 919, "type": "transition", "isManual": false, "createdAt": 1700000000408}, {"id": "pt_0_433", "x": 369, "y": 944, "type": "transition", "isManual": false, "createdAt": 1700000000433}, {"id": "pt_0_495", "x": 329, "y": 1006, "type": "transition", "isManual": false, "createdAt": 1700000000495}, {"id": "pt_0_516", "x": 332, "y": 1027, "type": "transition", "isManual": false, "createdAt": 1700000000516}, {"id": "pt_0_537", "x": 358, "y": 1048, "type": "transition", "isManual": false, "createdAt": 1700000000537}, {"id": "pt_0_560", "x": 333, "y": 1071, "type": "transition", "isManual": false, "createdAt": 1700000000560}, {"id": "pt_0_581", "x": 343, "y": 1092, "type": "transition", "isManual": false, "createdAt": 1700000000581}, {"id": "pt_0_617", "x": 334, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_0_619", "x": 497, "y": 1130, "type": "transition", "isManual": false, "createdAt": 1700000000619}, {"id": "pt_0_620", "x": 333, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_0_711", "x": 337, "y": 1222, "type": "transition", "isManual": false, "createdAt": 1700000000711}, {"id": "pt_0_747", "x": 325, "y": 1258, "type": "transition", "isManual": false, "createdAt": 1700000000747}, {"id": "pt_0_794", "x": 325, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_0_796", "x": 497, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_0_799", "x": 321, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_1",
        name: "Pinus",
        color: "#34d399",
        startX: 497,
        endX: 728,
        maxPercent: 100,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_1_0", "x": 499, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_1_23", "x": 655, "y": 534, "type": "transition", "isManual": false, "createdAt": 1700000000023}, {"id": "pt_1_66", "x": 640, "y": 577, "type": "transition", "isManual": false, "createdAt": 1700000000066}, {"id": "pt_1_108", "x": 687, "y": 619, "type": "transition", "isManual": false, "createdAt": 1700000000108}, {"id": "pt_1_184", "x": 701, "y": 695, "type": "transition", "isManual": false, "createdAt": 1700000000184}, {"id": "pt_1_302", "x": 648, "y": 813, "type": "transition", "isManual": false, "createdAt": 1700000000302}, {"id": "pt_1_307", "x": 728, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_1_309", "x": 655, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_1_325", "x": 666, "y": 836, "type": "transition", "isManual": false, "createdAt": 1700000000325}, {"id": "pt_1_346", "x": 606, "y": 857, "type": "transition", "isManual": false, "createdAt": 1700000000346}, {"id": "pt_1_407", "x": 599, "y": 918, "type": "transition", "isManual": false, "createdAt": 1700000000407}, {"id": "pt_1_473", "x": 602, "y": 984, "type": "transition", "isManual": false, "createdAt": 1700000000473}, {"id": "pt_1_495", "x": 660, "y": 1006, "type": "transition", "isManual": false, "createdAt": 1700000000495}, {"id": "pt_1_517", "x": 640, "y": 1028, "type": "transition", "isManual": false, "createdAt": 1700000000517}, {"id": "pt_1_537", "x": 667, "y": 1048, "type": "transition", "isManual": false, "createdAt": 1700000000537}, {"id": "pt_1_560", "x": 647, "y": 1071, "type": "transition", "isManual": false, "createdAt": 1700000000560}, {"id": "pt_1_582", "x": 666, "y": 1093, "type": "transition", "isManual": false, "createdAt": 1700000000582}, {"id": "pt_1_617", "x": 644, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_1_619", "x": 728, "y": 1130, "type": "transition", "isManual": false, "createdAt": 1700000000619}, {"id": "pt_1_620", "x": 640, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_1_709", "x": 546, "y": 1220, "type": "transition", "isManual": false, "createdAt": 1700000000709}, {"id": "pt_1_794", "x": 563, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_1_796", "x": 728, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_1_799", "x": 499, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_2",
        name: "Juniperus",
        color: "#fbbf24",
        startX: 728,
        endX: 864,
        maxPercent: 100,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_2_0", "x": 730, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_2_246", "x": 730, "y": 757, "type": "transition", "isManual": false, "createdAt": 1700000000246}, {"id": "pt_2_306", "x": 742, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_2_307", "x": 864, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_2_309", "x": 741, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_2_406", "x": 733, "y": 917, "type": "transition", "isManual": false, "createdAt": 1700000000406}, {"id": "pt_2_602", "x": 742, "y": 1113, "type": "transition", "isManual": false, "createdAt": 1700000000602}, {"id": "pt_2_617", "x": 755, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_2_618", "x": 864, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_2_620", "x": 757, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_2_665", "x": 774, "y": 1176, "type": "transition", "isManual": false, "createdAt": 1700000000665}, {"id": "pt_2_687", "x": 847, "y": 1198, "type": "transition", "isManual": false, "createdAt": 1700000000687}, {"id": "pt_2_709", "x": 821, "y": 1220, "type": "transition", "isManual": false, "createdAt": 1700000000709}, {"id": "pt_2_754", "x": 840, "y": 1265, "type": "transition", "isManual": false, "createdAt": 1700000000754}, {"id": "pt_2_777", "x": 777, "y": 1288, "type": "transition", "isManual": false, "createdAt": 1700000000777}, {"id": "pt_2_794", "x": 786, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_2_796", "x": 864, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_2_799", "x": 730, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_3",
        name: "Quercus ilex-type",
        color: "#a78bfa",
        startX: 864,
        endX: 939,
        maxPercent: 50,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_3_0", "x": 866, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_3_2", "x": 891, "y": 513, "type": "transition", "isManual": false, "createdAt": 1700000000002}, {"id": "pt_3_24", "x": 879, "y": 535, "type": "transition", "isManual": false, "createdAt": 1700000000024}, {"id": "pt_3_67", "x": 888, "y": 578, "type": "transition", "isManual": false, "createdAt": 1700000000067}, {"id": "pt_3_171", "x": 870, "y": 682, "type": "transition", "isManual": false, "createdAt": 1700000000171}, {"id": "pt_3_217", "x": 870, "y": 728, "type": "transition", "isManual": false, "createdAt": 1700000000217}, {"id": "pt_3_259", "x": 888, "y": 770, "type": "transition", "isManual": false, "createdAt": 1700000000259}, {"id": "pt_3_306", "x": 885, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_3_307", "x": 939, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_3_309", "x": 884, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_3_321", "x": 881, "y": 832, "type": "transition", "isManual": false, "createdAt": 1700000000321}, {"id": "pt_3_344", "x": 909, "y": 855, "type": "transition", "isManual": false, "createdAt": 1700000000344}, {"id": "pt_3_433", "x": 914, "y": 944, "type": "transition", "isManual": false, "createdAt": 1700000000433}, {"id": "pt_3_473", "x": 903, "y": 984, "type": "transition", "isManual": false, "createdAt": 1700000000473}, {"id": "pt_3_496", "x": 886, "y": 1007, "type": "transition", "isManual": false, "createdAt": 1700000000496}, {"id": "pt_3_615", "x": 876, "y": 1126, "type": "transition", "isManual": false, "createdAt": 1700000000615}, {"id": "pt_3_619", "x": 939, "y": 1130, "type": "transition", "isManual": false, "createdAt": 1700000000619}, {"id": "pt_3_620", "x": 877, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_3_666", "x": 890, "y": 1177, "type": "transition", "isManual": false, "createdAt": 1700000000666}, {"id": "pt_3_688", "x": 872, "y": 1199, "type": "transition", "isManual": false, "createdAt": 1700000000688}, {"id": "pt_3_727", "x": 867, "y": 1238, "type": "transition", "isManual": false, "createdAt": 1700000000727}, {"id": "pt_3_794", "x": 868, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_3_796", "x": 939, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_3_799", "x": 866, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_4",
        name: "Quercus suber-type",
        color: "#f472b6",
        startX: 939,
        endX: 971,
        maxPercent: 50,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_4_0", "x": 941, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_4_255", "x": 939, "y": 766, "type": "transition", "isManual": false, "createdAt": 1700000000255}, {"id": "pt_4_306", "x": 944, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_4_307", "x": 971, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_4_309", "x": 944, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_4_322", "x": 941, "y": 833, "type": "transition", "isManual": false, "createdAt": 1700000000322}, {"id": "pt_4_343", "x": 948, "y": 854, "type": "transition", "isManual": false, "createdAt": 1700000000343}, {"id": "pt_4_365", "x": 943, "y": 876, "type": "transition", "isManual": false, "createdAt": 1700000000365}, {"id": "pt_4_464", "x": 946, "y": 975, "type": "transition", "isManual": false, "createdAt": 1700000000464}, {"id": "pt_4_617", "x": 941, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_4_619", "x": 971, "y": 1130, "type": "transition", "isManual": false, "createdAt": 1700000000619}, {"id": "pt_4_620", "x": 941, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_4_734", "x": 939, "y": 1245, "type": "transition", "isManual": false, "createdAt": 1700000000734}, {"id": "pt_4_794", "x": 939, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_4_796", "x": 971, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_4_799", "x": 941, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_5",
        name: "Olea",
        color: "#fb7185",
        startX: 971,
        endX: 1001,
        maxPercent: 50,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_5_0", "x": 973, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_5_70", "x": 975, "y": 581, "type": "transition", "isManual": false, "createdAt": 1700000000070}, {"id": "pt_5_91", "x": 971, "y": 602, "type": "transition", "isManual": false, "createdAt": 1700000000091}, {"id": "pt_5_299", "x": 971, "y": 810, "type": "transition", "isManual": false, "createdAt": 1700000000299}, {"id": "pt_5_306", "x": 973, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_5_307", "x": 1001, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_5_309", "x": 973, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_5_617", "x": 973, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_5_618", "x": 1001, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_5_620", "x": 973, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_5_794", "x": 973, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_5_795", "x": 1001, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_5_799", "x": 973, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_6",
        name: "Betula",
        color: "#2dd4bf",
        startX: 1001,
        endX: 1033,
        maxPercent: 50,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_6_0", "x": 1003, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_6_237", "x": 1001, "y": 748, "type": "transition", "isManual": false, "createdAt": 1700000000237}, {"id": "pt_6_242", "x": 1004, "y": 753, "type": "transition", "isManual": false, "createdAt": 1700000000242}, {"id": "pt_6_272", "x": 1005, "y": 783, "type": "transition", "isManual": false, "createdAt": 1700000000272}, {"id": "pt_6_306", "x": 1001, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_6_307", "x": 1033, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_6_309", "x": 1003, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_6_313", "x": 1001, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_6_339", "x": 1005, "y": 850, "type": "transition", "isManual": false, "createdAt": 1700000000339}, {"id": "pt_6_402", "x": 1004, "y": 913, "type": "transition", "isManual": false, "createdAt": 1700000000402}, {"id": "pt_6_410", "x": 1001, "y": 921, "type": "transition", "isManual": false, "createdAt": 1700000000410}, {"id": "pt_6_617", "x": 1001, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_6_618", "x": 1033, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_6_620", "x": 1003, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_6_623", "x": 1001, "y": 1134, "type": "transition", "isManual": false, "createdAt": 1700000000623}, {"id": "pt_6_731", "x": 1001, "y": 1242, "type": "transition", "isManual": false, "createdAt": 1700000000731}, {"id": "pt_6_747", "x": 1005, "y": 1258, "type": "transition", "isManual": false, "createdAt": 1700000000747}, {"id": "pt_6_792", "x": 1006, "y": 1303, "type": "transition", "isManual": false, "createdAt": 1700000000792}, {"id": "pt_6_795", "x": 1033, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_6_799", "x": 1003, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_7",
        name: "Corylus",
        color: "#818cf8",
        startX: 1033,
        endX: 1065,
        maxPercent: 50,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_7_0", "x": 1035, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_7_2", "x": 1039, "y": 513, "type": "transition", "isManual": false, "createdAt": 1700000000002}, {"id": "pt_7_24", "x": 1035, "y": 535, "type": "transition", "isManual": false, "createdAt": 1700000000024}, {"id": "pt_7_64", "x": 1044, "y": 575, "type": "transition", "isManual": false, "createdAt": 1700000000064}, {"id": "pt_7_106", "x": 1035, "y": 617, "type": "transition", "isManual": false, "createdAt": 1700000000106}, {"id": "pt_7_223", "x": 1037, "y": 734, "type": "transition", "isManual": false, "createdAt": 1700000000223}, {"id": "pt_7_255", "x": 1042, "y": 766, "type": "transition", "isManual": false, "createdAt": 1700000000255}, {"id": "pt_7_306", "x": 1037, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_7_307", "x": 1065, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_7_309", "x": 1038, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_7_390", "x": 1042, "y": 901, "type": "transition", "isManual": false, "createdAt": 1700000000390}, {"id": "pt_7_498", "x": 1039, "y": 1009, "type": "transition", "isManual": false, "createdAt": 1700000000498}, {"id": "pt_7_515", "x": 1044, "y": 1026, "type": "transition", "isManual": false, "createdAt": 1700000000515}, {"id": "pt_7_606", "x": 1039, "y": 1117, "type": "transition", "isManual": false, "createdAt": 1700000000606}, {"id": "pt_7_617", "x": 1041, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_7_619", "x": 1065, "y": 1130, "type": "transition", "isManual": false, "createdAt": 1700000000619}, {"id": "pt_7_620", "x": 1042, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_7_668", "x": 1033, "y": 1179, "type": "transition", "isManual": false, "createdAt": 1700000000668}, {"id": "pt_7_748", "x": 1037, "y": 1259, "type": "transition", "isManual": false, "createdAt": 1700000000748}, {"id": "pt_7_794", "x": 1033, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_7_796", "x": 1065, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_7_799", "x": 1035, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_8",
        name: "Carpinus-type",
        color: "#f97316",
        startX: 1065,
        endX: 1097,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_8_0", "x": 1067, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_8_104", "x": 1065, "y": 615, "type": "transition", "isManual": false, "createdAt": 1700000000104}, {"id": "pt_8_117", "x": 1068, "y": 628, "type": "transition", "isManual": false, "createdAt": 1700000000117}, {"id": "pt_8_176", "x": 1067, "y": 687, "type": "transition", "isManual": false, "createdAt": 1700000000176}, {"id": "pt_8_236", "x": 1071, "y": 747, "type": "transition", "isManual": false, "createdAt": 1700000000236}, {"id": "pt_8_306", "x": 1069, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_8_307", "x": 1097, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_8_309", "x": 1070, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_8_371", "x": 1071, "y": 882, "type": "transition", "isManual": false, "createdAt": 1700000000371}, {"id": "pt_8_427", "x": 1067, "y": 938, "type": "transition", "isManual": false, "createdAt": 1700000000427}, {"id": "pt_8_480", "x": 1069, "y": 991, "type": "transition", "isManual": false, "createdAt": 1700000000480}, {"id": "pt_8_499", "x": 1065, "y": 1010, "type": "transition", "isManual": false, "createdAt": 1700000000499}, {"id": "pt_8_601", "x": 1065, "y": 1112, "type": "transition", "isManual": false, "createdAt": 1700000000601}, {"id": "pt_8_616", "x": 1069, "y": 1127, "type": "transition", "isManual": false, "createdAt": 1700000000616}, {"id": "pt_8_618", "x": 1097, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_8_620", "x": 1070, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_8_671", "x": 1069, "y": 1182, "type": "transition", "isManual": false, "createdAt": 1700000000671}, {"id": "pt_8_689", "x": 1065, "y": 1200, "type": "transition", "isManual": false, "createdAt": 1700000000689}, {"id": "pt_8_757", "x": 1065, "y": 1268, "type": "transition", "isManual": false, "createdAt": 1700000000757}, {"id": "pt_8_758", "x": 1068, "y": 1269, "type": "transition", "isManual": false, "createdAt": 1700000000758}, {"id": "pt_8_794", "x": 1069, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_8_796", "x": 1097, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_8_799", "x": 1067, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_9",
        name: "Ericaceae",
        color: "#4ade80",
        startX: 1097,
        endX: 1129,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_9_0", "x": 1099, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_9_306", "x": 1097, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_9_307", "x": 1129, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_9_309", "x": 1099, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_9_313", "x": 1097, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_9_340", "x": 1101, "y": 851, "type": "transition", "isManual": false, "createdAt": 1700000000340}, {"id": "pt_9_368", "x": 1097, "y": 879, "type": "transition", "isManual": false, "createdAt": 1700000000368}, {"id": "pt_9_617", "x": 1097, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_9_618", "x": 1129, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_9_620", "x": 1099, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_9_623", "x": 1097, "y": 1134, "type": "transition", "isManual": false, "createdAt": 1700000000623}, {"id": "pt_9_794", "x": 1097, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_9_795", "x": 1129, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_9_799", "x": 1099, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_10",
        name: "Ephedra distachya-type",
        color: "#e879f9",
        startX: 1129,
        endX: 1161,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_10_0", "x": 1131, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_10_221", "x": 1133, "y": 732, "type": "transition", "isManual": false, "createdAt": 1700000000221}, {"id": "pt_10_255", "x": 1129, "y": 766, "type": "transition", "isManual": false, "createdAt": 1700000000255}, {"id": "pt_10_306", "x": 1134, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_10_307", "x": 1161, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_10_310", "x": 1133, "y": 821, "type": "transition", "isManual": false, "createdAt": 1700000000310}, {"id": "pt_10_368", "x": 1129, "y": 879, "type": "transition", "isManual": false, "createdAt": 1700000000368}, {"id": "pt_10_406", "x": 1129, "y": 917, "type": "transition", "isManual": false, "createdAt": 1700000000406}, {"id": "pt_10_429", "x": 1135, "y": 940, "type": "transition", "isManual": false, "createdAt": 1700000000429}, {"id": "pt_10_534", "x": 1131, "y": 1045, "type": "transition", "isManual": false, "createdAt": 1700000000534}, {"id": "pt_10_617", "x": 1132, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_10_618", "x": 1161, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_10_620", "x": 1131, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_10_625", "x": 1129, "y": 1136, "type": "transition", "isManual": false, "createdAt": 1700000000625}, {"id": "pt_10_663", "x": 1129, "y": 1174, "type": "transition", "isManual": false, "createdAt": 1700000000663}, {"id": "pt_10_687", "x": 1135, "y": 1198, "type": "transition", "isManual": false, "createdAt": 1700000000687}, {"id": "pt_10_753", "x": 1131, "y": 1264, "type": "transition", "isManual": false, "createdAt": 1700000000753}, {"id": "pt_10_774", "x": 1147, "y": 1285, "type": "transition", "isManual": false, "createdAt": 1700000000774}, {"id": "pt_10_794", "x": 1145, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_10_796", "x": 1161, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_10_799", "x": 1131, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_11",
        name: "Ephedra fragilis",
        color: "#60a5fa",
        startX: 1161,
        endX: 1193,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_11_0", "x": 1163, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_11_70", "x": 1165, "y": 581, "type": "transition", "isManual": false, "createdAt": 1700000000070}, {"id": "pt_11_91", "x": 1161, "y": 602, "type": "transition", "isManual": false, "createdAt": 1700000000091}, {"id": "pt_11_192", "x": 1161, "y": 703, "type": "transition", "isManual": false, "createdAt": 1700000000192}, {"id": "pt_11_213", "x": 1165, "y": 724, "type": "transition", "isManual": false, "createdAt": 1700000000213}, {"id": "pt_11_306", "x": 1165, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_11_307", "x": 1193, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_11_309", "x": 1164, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_11_319", "x": 1163, "y": 830, "type": "transition", "isManual": false, "createdAt": 1700000000319}, {"id": "pt_11_496", "x": 1163, "y": 1007, "type": "transition", "isManual": false, "createdAt": 1700000000496}, {"id": "pt_11_515", "x": 1170, "y": 1026, "type": "transition", "isManual": false, "createdAt": 1700000000515}, {"id": "pt_11_555", "x": 1163, "y": 1066, "type": "transition", "isManual": false, "createdAt": 1700000000555}, {"id": "pt_11_581", "x": 1167, "y": 1092, "type": "transition", "isManual": false, "createdAt": 1700000000581}, {"id": "pt_11_617", "x": 1164, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_11_619", "x": 1193, "y": 1130, "type": "transition", "isManual": false, "createdAt": 1700000000619}, {"id": "pt_11_620", "x": 1163, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_11_625", "x": 1161, "y": 1136, "type": "transition", "isManual": false, "createdAt": 1700000000625}, {"id": "pt_11_663", "x": 1161, "y": 1174, "type": "transition", "isManual": false, "createdAt": 1700000000663}, {"id": "pt_11_684", "x": 1165, "y": 1195, "type": "transition", "isManual": false, "createdAt": 1700000000684}, {"id": "pt_11_791", "x": 1164, "y": 1302, "type": "transition", "isManual": false, "createdAt": 1700000000791}, {"id": "pt_11_794", "x": 1165, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_11_796", "x": 1193, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_11_799", "x": 1163, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_12",
        name: "Mentha-type",
        color: "#38bdf8",
        startX: 1193,
        endX: 1225,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_12_0", "x": 1195, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_12_306", "x": 1193, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_12_307", "x": 1225, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_12_309", "x": 1195, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_12_313", "x": 1193, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_12_601", "x": 1193, "y": 1112, "type": "transition", "isManual": false, "createdAt": 1700000000601}, {"id": "pt_12_617", "x": 1196, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_12_618", "x": 1225, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_12_620", "x": 1196, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_12_668", "x": 1193, "y": 1179, "type": "transition", "isManual": false, "createdAt": 1700000000668}, {"id": "pt_12_794", "x": 1193, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_12_796", "x": 1225, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_12_799", "x": 1195, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_13",
        name: "Anthemis-type",
        color: "#34d399",
        startX: 1225,
        endX: 1255,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_13_0", "x": 1227, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_13_306", "x": 1225, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_13_307", "x": 1255, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_13_309", "x": 1227, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_13_313", "x": 1225, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_13_617", "x": 1227, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_13_618", "x": 1255, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_13_620", "x": 1227, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_13_794", "x": 1229, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_13_795", "x": 1255, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_13_799", "x": 1227, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_14",
        name: "Artemisia",
        color: "#fbbf24",
        startX: 1255,
        endX: 1330,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_14_0", "x": 1257, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_14_2", "x": 1268, "y": 513, "type": "transition", "isManual": false, "createdAt": 1700000000002}, {"id": "pt_14_108", "x": 1257, "y": 619, "type": "transition", "isManual": false, "createdAt": 1700000000108}, {"id": "pt_14_147", "x": 1264, "y": 658, "type": "transition", "isManual": false, "createdAt": 1700000000147}, {"id": "pt_14_306", "x": 1259, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_14_307", "x": 1330, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_14_309", "x": 1259, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_14_453", "x": 1266, "y": 964, "type": "transition", "isManual": false, "createdAt": 1700000000453}, {"id": "pt_14_475", "x": 1282, "y": 986, "type": "transition", "isManual": false, "createdAt": 1700000000475}, {"id": "pt_14_496", "x": 1266, "y": 1007, "type": "transition", "isManual": false, "createdAt": 1700000000496}, {"id": "pt_14_517", "x": 1270, "y": 1028, "type": "transition", "isManual": false, "createdAt": 1700000000517}, {"id": "pt_14_581", "x": 1257, "y": 1092, "type": "transition", "isManual": false, "createdAt": 1700000000581}, {"id": "pt_14_617", "x": 1265, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_14_618", "x": 1330, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_14_620", "x": 1265, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_14_668", "x": 1271, "y": 1179, "type": "transition", "isManual": false, "createdAt": 1700000000668}, {"id": "pt_14_687", "x": 1258, "y": 1198, "type": "transition", "isManual": false, "createdAt": 1700000000687}, {"id": "pt_14_709", "x": 1300, "y": 1220, "type": "transition", "isManual": false, "createdAt": 1700000000709}, {"id": "pt_14_732", "x": 1279, "y": 1243, "type": "transition", "isManual": false, "createdAt": 1700000000732}, {"id": "pt_14_752", "x": 1280, "y": 1263, "type": "transition", "isManual": false, "createdAt": 1700000000752}, {"id": "pt_14_774", "x": 1314, "y": 1285, "type": "transition", "isManual": false, "createdAt": 1700000000774}, {"id": "pt_14_794", "x": 1303, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_14_796", "x": 1330, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_14_799", "x": 1257, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_15",
        name: "Caryophyllaceae",
        color: "#a78bfa",
        startX: 1330,
        endX: 1362,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_15_0", "x": 1332, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_15_306", "x": 1330, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_15_307", "x": 1362, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_15_309", "x": 1332, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_15_313", "x": 1330, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_15_354", "x": 1333, "y": 865, "type": "transition", "isManual": false, "createdAt": 1700000000354}, {"id": "pt_15_410", "x": 1330, "y": 921, "type": "transition", "isManual": false, "createdAt": 1700000000410}, {"id": "pt_15_617", "x": 1330, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_15_618", "x": 1362, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_15_620", "x": 1332, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_15_623", "x": 1330, "y": 1134, "type": "transition", "isManual": false, "createdAt": 1700000000623}, {"id": "pt_15_794", "x": 1330, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_15_795", "x": 1362, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_15_799", "x": 1332, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_16",
        name: "Chenopodiaceae",
        color: "#f472b6",
        startX: 1362,
        endX: 1436,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_16_0", "x": 1364, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_16_2", "x": 1410, "y": 513, "type": "transition", "isManual": false, "createdAt": 1700000000002}, {"id": "pt_16_22", "x": 1395, "y": 533, "type": "transition", "isManual": false, "createdAt": 1700000000022}, {"id": "pt_16_46", "x": 1406, "y": 557, "type": "transition", "isManual": false, "createdAt": 1700000000046}, {"id": "pt_16_87", "x": 1366, "y": 598, "type": "transition", "isManual": false, "createdAt": 1700000000087}, {"id": "pt_16_149", "x": 1383, "y": 660, "type": "transition", "isManual": false, "createdAt": 1700000000149}, {"id": "pt_16_196", "x": 1367, "y": 707, "type": "transition", "isManual": false, "createdAt": 1700000000196}, {"id": "pt_16_306", "x": 1369, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_16_307", "x": 1436, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_16_309", "x": 1368, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_16_321", "x": 1367, "y": 832, "type": "transition", "isManual": false, "createdAt": 1700000000321}, {"id": "pt_16_427", "x": 1397, "y": 938, "type": "transition", "isManual": false, "createdAt": 1700000000427}, {"id": "pt_16_496", "x": 1369, "y": 1007, "type": "transition", "isManual": false, "createdAt": 1700000000496}, {"id": "pt_16_602", "x": 1396, "y": 1113, "type": "transition", "isManual": false, "createdAt": 1700000000602}, {"id": "pt_16_617", "x": 1384, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_16_618", "x": 1436, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_16_624", "x": 1378, "y": 1135, "type": "transition", "isManual": false, "createdAt": 1700000000624}, {"id": "pt_16_708", "x": 1406, "y": 1219, "type": "transition", "isManual": false, "createdAt": 1700000000708}, {"id": "pt_16_733", "x": 1381, "y": 1244, "type": "transition", "isManual": false, "createdAt": 1700000000733}, {"id": "pt_16_773", "x": 1413, "y": 1284, "type": "transition", "isManual": false, "createdAt": 1700000000773}, {"id": "pt_16_794", "x": 1402, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_16_796", "x": 1436, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_16_799", "x": 1364, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_17",
        name: "Cruciferae",
        color: "#fb7185",
        startX: 1436,
        endX: 1468,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_17_0", "x": 1438, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_17_306", "x": 1436, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_17_307", "x": 1468, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_17_309", "x": 1438, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_17_313", "x": 1436, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_17_360", "x": 1440, "y": 871, "type": "transition", "isManual": false, "createdAt": 1700000000360}, {"id": "pt_17_432", "x": 1436, "y": 943, "type": "transition", "isManual": false, "createdAt": 1700000000432}, {"id": "pt_17_617", "x": 1436, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_17_618", "x": 1468, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_17_620", "x": 1438, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_17_623", "x": 1436, "y": 1134, "type": "transition", "isManual": false, "createdAt": 1700000000623}, {"id": "pt_17_686", "x": 1436, "y": 1197, "type": "transition", "isManual": false, "createdAt": 1700000000686}, {"id": "pt_17_703", "x": 1440, "y": 1214, "type": "transition", "isManual": false, "createdAt": 1700000000703}, {"id": "pt_17_760", "x": 1440, "y": 1271, "type": "transition", "isManual": false, "createdAt": 1700000000760}, {"id": "pt_17_794", "x": 1436, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_17_795", "x": 1468, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_17_799", "x": 1438, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_18",
        name: "Filipendula",
        color: "#2dd4bf",
        startX: 1468,
        endX: 1500,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_18_0", "x": 1470, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_18_306", "x": 1468, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_18_307", "x": 1500, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_18_309", "x": 1470, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_18_313", "x": 1468, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_18_617", "x": 1468, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_18_618", "x": 1500, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_18_620", "x": 1470, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_18_623", "x": 1468, "y": 1134, "type": "transition", "isManual": false, "createdAt": 1700000000623}, {"id": "pt_18_794", "x": 1468, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_18_795", "x": 1500, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_18_799", "x": 1470, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_19",
        name: "Gramineae <40um",
        color: "#818cf8",
        startX: 1500,
        endX: 1552,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_19_0", "x": 1502, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_19_2", "x": 1541, "y": 513, "type": "transition", "isManual": false, "createdAt": 1700000000002}, {"id": "pt_19_24", "x": 1513, "y": 535, "type": "transition", "isManual": false, "createdAt": 1700000000024}, {"id": "pt_19_47", "x": 1510, "y": 558, "type": "transition", "isManual": false, "createdAt": 1700000000047}, {"id": "pt_19_68", "x": 1518, "y": 579, "type": "transition", "isManual": false, "createdAt": 1700000000068}, {"id": "pt_19_109", "x": 1502, "y": 620, "type": "transition", "isManual": false, "createdAt": 1700000000109}, {"id": "pt_19_306", "x": 1512, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_19_307", "x": 1552, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_19_311", "x": 1511, "y": 822, "type": "transition", "isManual": false, "createdAt": 1700000000311}, {"id": "pt_19_404", "x": 1518, "y": 915, "type": "transition", "isManual": false, "createdAt": 1700000000404}, {"id": "pt_19_431", "x": 1513, "y": 942, "type": "transition", "isManual": false, "createdAt": 1700000000431}, {"id": "pt_19_456", "x": 1520, "y": 967, "type": "transition", "isManual": false, "createdAt": 1700000000456}, {"id": "pt_19_495", "x": 1506, "y": 1006, "type": "transition", "isManual": false, "createdAt": 1700000000495}, {"id": "pt_19_533", "x": 1504, "y": 1044, "type": "transition", "isManual": false, "createdAt": 1700000000533}, {"id": "pt_19_617", "x": 1511, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_19_618", "x": 1552, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_19_620", "x": 1512, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_19_667", "x": 1515, "y": 1178, "type": "transition", "isManual": false, "createdAt": 1700000000667}, {"id": "pt_19_688", "x": 1508, "y": 1199, "type": "transition", "isManual": false, "createdAt": 1700000000688}, {"id": "pt_19_708", "x": 1522, "y": 1219, "type": "transition", "isManual": false, "createdAt": 1700000000708}, {"id": "pt_19_777", "x": 1515, "y": 1288, "type": "transition", "isManual": false, "createdAt": 1700000000777}, {"id": "pt_19_794", "x": 1520, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_19_796", "x": 1552, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_19_799", "x": 1502, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_20",
        name: "Gramineae >40<50um",
        color: "#f97316",
        startX: 1552,
        endX: 1584,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_20_0", "x": 1554, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_20_2", "x": 1559, "y": 513, "type": "transition", "isManual": false, "createdAt": 1700000000002}, {"id": "pt_20_163", "x": 1555, "y": 674, "type": "transition", "isManual": false, "createdAt": 1700000000163}, {"id": "pt_20_174", "x": 1552, "y": 685, "type": "transition", "isManual": false, "createdAt": 1700000000174}, {"id": "pt_20_192", "x": 1552, "y": 703, "type": "transition", "isManual": false, "createdAt": 1700000000192}, {"id": "pt_20_213", "x": 1557, "y": 724, "type": "transition", "isManual": false, "createdAt": 1700000000213}, {"id": "pt_20_305", "x": 1557, "y": 816, "type": "transition", "isManual": false, "createdAt": 1700000000305}, {"id": "pt_20_307", "x": 1584, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_20_309", "x": 1558, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_20_342", "x": 1561, "y": 853, "type": "transition", "isManual": false, "createdAt": 1700000000342}, {"id": "pt_20_457", "x": 1561, "y": 968, "type": "transition", "isManual": false, "createdAt": 1700000000457}, {"id": "pt_20_497", "x": 1555, "y": 1008, "type": "transition", "isManual": false, "createdAt": 1700000000497}, {"id": "pt_20_617", "x": 1555, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_20_618", "x": 1584, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_20_620", "x": 1555, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_20_731", "x": 1555, "y": 1242, "type": "transition", "isManual": false, "createdAt": 1700000000731}, {"id": "pt_20_750", "x": 1559, "y": 1261, "type": "transition", "isManual": false, "createdAt": 1700000000750}, {"id": "pt_20_794", "x": 1556, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_20_796", "x": 1584, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_20_799", "x": 1554, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_21",
        name: "Gramineae >50<60um",
        color: "#4ade80",
        startX: 1584,
        endX: 1616,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_21_0", "x": 1586, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_21_192", "x": 1584, "y": 703, "type": "transition", "isManual": false, "createdAt": 1700000000192}, {"id": "pt_21_306", "x": 1589, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_21_307", "x": 1616, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_21_312", "x": 1588, "y": 823, "type": "transition", "isManual": false, "createdAt": 1700000000312}, {"id": "pt_21_414", "x": 1591, "y": 925, "type": "transition", "isManual": false, "createdAt": 1700000000414}, {"id": "pt_21_499", "x": 1584, "y": 1010, "type": "transition", "isManual": false, "createdAt": 1700000000499}, {"id": "pt_21_617", "x": 1584, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_21_618", "x": 1616, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_21_623", "x": 1585, "y": 1134, "type": "transition", "isManual": false, "createdAt": 1700000000623}, {"id": "pt_21_671", "x": 1589, "y": 1182, "type": "transition", "isManual": false, "createdAt": 1700000000671}, {"id": "pt_21_794", "x": 1584, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_21_796", "x": 1616, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_21_799", "x": 1586, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_22",
        name: "Gramineae >60um",
        color: "#e879f9",
        startX: 1616,
        endX: 1648,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_22_0", "x": 1618, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_22_306", "x": 1618, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_22_307", "x": 1648, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_22_309", "x": 1618, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_22_358", "x": 1621, "y": 869, "type": "transition", "isManual": false, "createdAt": 1700000000358}, {"id": "pt_22_430", "x": 1619, "y": 941, "type": "transition", "isManual": false, "createdAt": 1700000000430}, {"id": "pt_22_455", "x": 1623, "y": 966, "type": "transition", "isManual": false, "createdAt": 1700000000455}, {"id": "pt_22_472", "x": 1618, "y": 983, "type": "transition", "isManual": false, "createdAt": 1700000000472}, {"id": "pt_22_499", "x": 1616, "y": 1010, "type": "transition", "isManual": false, "createdAt": 1700000000499}, {"id": "pt_22_557", "x": 1616, "y": 1068, "type": "transition", "isManual": false, "createdAt": 1700000000557}, {"id": "pt_22_571", "x": 1619, "y": 1082, "type": "transition", "isManual": false, "createdAt": 1700000000571}, {"id": "pt_22_617", "x": 1616, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_22_618", "x": 1648, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_22_620", "x": 1618, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_22_623", "x": 1616, "y": 1134, "type": "transition", "isManual": false, "createdAt": 1700000000623}, {"id": "pt_22_794", "x": 1616, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_22_795", "x": 1648, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_22_799", "x": 1618, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_23",
        name: "Liguliflorae",
        color: "#60a5fa",
        startX: 1648,
        endX: 1680,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_23_0", "x": 1650, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_23_306", "x": 1648, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_23_307", "x": 1680, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_23_309", "x": 1650, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_23_313", "x": 1648, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_23_335", "x": 1651, "y": 846, "type": "transition", "isManual": false, "createdAt": 1700000000335}, {"id": "pt_23_601", "x": 1648, "y": 1112, "type": "transition", "isManual": false, "createdAt": 1700000000601}, {"id": "pt_23_617", "x": 1651, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_23_618", "x": 1680, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_23_620", "x": 1651, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_23_668", "x": 1648, "y": 1179, "type": "transition", "isManual": false, "createdAt": 1700000000668}, {"id": "pt_23_794", "x": 1648, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_23_796", "x": 1680, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_23_799", "x": 1650, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_24",
        name: "Plantago coronopus",
        color: "#38bdf8",
        startX: 1680,
        endX: 1711,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_24_0", "x": 1682, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_24_23", "x": 1689, "y": 534, "type": "transition", "isManual": false, "createdAt": 1700000000023}, {"id": "pt_24_45", "x": 1689, "y": 556, "type": "transition", "isManual": false, "createdAt": 1700000000045}, {"id": "pt_24_77", "x": 1682, "y": 588, "type": "transition", "isManual": false, "createdAt": 1700000000077}, {"id": "pt_24_155", "x": 1685, "y": 666, "type": "transition", "isManual": false, "createdAt": 1700000000155}, {"id": "pt_24_174", "x": 1680, "y": 685, "type": "transition", "isManual": false, "createdAt": 1700000000174}, {"id": "pt_24_299", "x": 1680, "y": 810, "type": "transition", "isManual": false, "createdAt": 1700000000299}, {"id": "pt_24_306", "x": 1682, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_24_307", "x": 1711, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_24_309", "x": 1682, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_24_341", "x": 1685, "y": 852, "type": "transition", "isManual": false, "createdAt": 1700000000341}, {"id": "pt_24_414", "x": 1682, "y": 925, "type": "transition", "isManual": false, "createdAt": 1700000000414}, {"id": "pt_24_438", "x": 1685, "y": 949, "type": "transition", "isManual": false, "createdAt": 1700000000438}, {"id": "pt_24_476", "x": 1680, "y": 987, "type": "transition", "isManual": false, "createdAt": 1700000000476}, {"id": "pt_24_617", "x": 1680, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_24_618", "x": 1711, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_24_620", "x": 1682, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_24_623", "x": 1680, "y": 1134, "type": "transition", "isManual": false, "createdAt": 1700000000623}, {"id": "pt_24_794", "x": 1680, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_24_795", "x": 1711, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_24_799", "x": 1682, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_25",
        name: "Pteridium",
        color: "#34d399",
        startX: 1711,
        endX: 1743,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_25_0", "x": 1713, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_25_160", "x": 1715, "y": 671, "type": "transition", "isManual": false, "createdAt": 1700000000160}, {"id": "pt_25_192", "x": 1711, "y": 703, "type": "transition", "isManual": false, "createdAt": 1700000000192}, {"id": "pt_25_278", "x": 1715, "y": 789, "type": "transition", "isManual": false, "createdAt": 1700000000278}, {"id": "pt_25_306", "x": 1711, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_25_307", "x": 1743, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_25_309", "x": 1713, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_25_313", "x": 1711, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_25_391", "x": 1715, "y": 902, "type": "transition", "isManual": false, "createdAt": 1700000000391}, {"id": "pt_25_601", "x": 1711, "y": 1112, "type": "transition", "isManual": false, "createdAt": 1700000000601}, {"id": "pt_25_617", "x": 1713, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_25_618", "x": 1743, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_25_620", "x": 1713, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_25_794", "x": 1711, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_25_795", "x": 1743, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_25_799", "x": 1713, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_26",
        name: "Filicales",
        color: "#fbbf24",
        startX: 1743,
        endX: 1774,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_26_0", "x": 1745, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_26_42", "x": 1743, "y": 553, "type": "transition", "isManual": false, "createdAt": 1700000000042}, {"id": "pt_26_96", "x": 1747, "y": 607, "type": "transition", "isManual": false, "createdAt": 1700000000096}, {"id": "pt_26_108", "x": 1746, "y": 619, "type": "transition", "isManual": false, "createdAt": 1700000000108}, {"id": "pt_26_110", "x": 1743, "y": 621, "type": "transition", "isManual": false, "createdAt": 1700000000110}, {"id": "pt_26_306", "x": 1743, "y": 817, "type": "transition", "isManual": false, "createdAt": 1700000000306}, {"id": "pt_26_307", "x": 1774, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_26_309", "x": 1745, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_26_313", "x": 1743, "y": 824, "type": "transition", "isManual": false, "createdAt": 1700000000313}, {"id": "pt_26_450", "x": 1743, "y": 961, "type": "transition", "isManual": false, "createdAt": 1700000000450}, {"id": "pt_26_466", "x": 1747, "y": 977, "type": "transition", "isManual": false, "createdAt": 1700000000466}, {"id": "pt_26_617", "x": 1745, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_26_618", "x": 1774, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_26_620", "x": 1745, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_26_625", "x": 1743, "y": 1136, "type": "transition", "isManual": false, "createdAt": 1700000000625}, {"id": "pt_26_794", "x": 1743, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_26_795", "x": 1774, "y": 1306, "type": "transition", "isManual": false, "createdAt": 1700000000795}, {"id": "pt_26_799", "x": 1745, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_27",
        name: "Pollen Concentration",
        color: "#a78bfa",
        startX: 1774,
        endX: 1845,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_27_0", "x": 1776, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_27_2", "x": 1783, "y": 513, "type": "transition", "isManual": false, "createdAt": 1700000000002}, {"id": "pt_27_23", "x": 1779, "y": 534, "type": "transition", "isManual": false, "createdAt": 1700000000023}, {"id": "pt_27_43", "x": 1788, "y": 554, "type": "transition", "isManual": false, "createdAt": 1700000000043}, {"id": "pt_27_79", "x": 1783, "y": 590, "type": "transition", "isManual": false, "createdAt": 1700000000079}, {"id": "pt_27_139", "x": 1781, "y": 650, "type": "transition", "isManual": false, "createdAt": 1700000000139}, {"id": "pt_27_191", "x": 1786, "y": 702, "type": "transition", "isManual": false, "createdAt": 1700000000191}, {"id": "pt_27_216", "x": 1783, "y": 727, "type": "transition", "isManual": false, "createdAt": 1700000000216}, {"id": "pt_27_237", "x": 1816, "y": 748, "type": "transition", "isManual": false, "createdAt": 1700000000237}, {"id": "pt_27_259", "x": 1806, "y": 770, "type": "transition", "isManual": false, "createdAt": 1700000000259}, {"id": "pt_27_300", "x": 1845, "y": 811, "type": "transition", "isManual": false, "createdAt": 1700000000300}, {"id": "pt_27_303", "x": 1776, "y": 814, "type": "transition", "isManual": false, "createdAt": 1700000000303}, {"id": "pt_27_554", "x": 1776, "y": 1065, "type": "transition", "isManual": false, "createdAt": 1700000000554}, {"id": "pt_27_555", "x": 1845, "y": 1066, "type": "transition", "isManual": false, "createdAt": 1700000000555}, {"id": "pt_27_560", "x": 1839, "y": 1071, "type": "transition", "isManual": false, "createdAt": 1700000000560}, {"id": "pt_27_566", "x": 1845, "y": 1077, "type": "transition", "isManual": false, "createdAt": 1700000000566}, {"id": "pt_27_567", "x": 1776, "y": 1078, "type": "transition", "isManual": false, "createdAt": 1700000000567}, {"id": "pt_27_768", "x": 1776, "y": 1279, "type": "transition", "isManual": false, "createdAt": 1700000000768}, {"id": "pt_27_769", "x": 1845, "y": 1280, "type": "transition", "isManual": false, "createdAt": 1700000000769}, {"id": "pt_27_794", "x": 1803, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_27_796", "x": 1845, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_27_799", "x": 1776, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
      {
        id: "taxa_28",
        name: "Col 28",
        color: "#f472b6",
        startX: 1845,
        endX: 1946,
        maxPercent: 20,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: [{"id": "pt_28_0", "x": 1845, "y": 511, "type": "transition", "isManual": false, "createdAt": 1700000000000}, {"id": "pt_28_300", "x": 1845, "y": 811, "type": "transition", "isManual": false, "createdAt": 1700000000300}, {"id": "pt_28_307", "x": 1946, "y": 818, "type": "transition", "isManual": false, "createdAt": 1700000000307}, {"id": "pt_28_309", "x": 1875, "y": 820, "type": "transition", "isManual": false, "createdAt": 1700000000309}, {"id": "pt_28_324", "x": 1927, "y": 835, "type": "transition", "isManual": false, "createdAt": 1700000000324}, {"id": "pt_28_366", "x": 1847, "y": 877, "type": "transition", "isManual": false, "createdAt": 1700000000366}, {"id": "pt_28_409", "x": 1909, "y": 920, "type": "transition", "isManual": false, "createdAt": 1700000000409}, {"id": "pt_28_430", "x": 1863, "y": 941, "type": "transition", "isManual": false, "createdAt": 1700000000430}, {"id": "pt_28_454", "x": 1886, "y": 965, "type": "transition", "isManual": false, "createdAt": 1700000000454}, {"id": "pt_28_517", "x": 1847, "y": 1028, "type": "transition", "isManual": false, "createdAt": 1700000000517}, {"id": "pt_28_539", "x": 1877, "y": 1050, "type": "transition", "isManual": false, "createdAt": 1700000000539}, {"id": "pt_28_557", "x": 1845, "y": 1068, "type": "transition", "isManual": false, "createdAt": 1700000000557}, {"id": "pt_28_581", "x": 1868, "y": 1092, "type": "transition", "isManual": false, "createdAt": 1700000000581}, {"id": "pt_28_617", "x": 1856, "y": 1128, "type": "transition", "isManual": false, "createdAt": 1700000000617}, {"id": "pt_28_618", "x": 1946, "y": 1129, "type": "transition", "isManual": false, "createdAt": 1700000000618}, {"id": "pt_28_620", "x": 1858, "y": 1131, "type": "transition", "isManual": false, "createdAt": 1700000000620}, {"id": "pt_28_666", "x": 1856, "y": 1177, "type": "transition", "isManual": false, "createdAt": 1700000000666}, {"id": "pt_28_692", "x": 1889, "y": 1203, "type": "transition", "isManual": false, "createdAt": 1700000000692}, {"id": "pt_28_732", "x": 1855, "y": 1243, "type": "transition", "isManual": false, "createdAt": 1700000000732}, {"id": "pt_28_754", "x": 1884, "y": 1265, "type": "transition", "isManual": false, "createdAt": 1700000000754}, {"id": "pt_28_794", "x": 1845, "y": 1305, "type": "transition", "isManual": false, "createdAt": 1700000000794}, {"id": "pt_28_796", "x": 1946, "y": 1307, "type": "transition", "isManual": false, "createdAt": 1700000000796}, {"id": "pt_28_799", "x": 1845, "y": 1310, "type": "transition", "isManual": false, "createdAt": 1700000000799}],
      },
    ];

    return {
      imageSrc: './hoya-del-castillo.png',
      imageWidth: 2339,
      imageHeight: 1654,
      calibration,
      columns,
      activeTaxaId: 'taxa_1',
      selectedEntity: null,
    };
  }

  public static getVerificationDiagramData(): DiagramData {
    const calibration: DiagramCalibration = {
      dataXMin: 120,
      dataXMax: 1020,
      dataYMin: 80,
      dataYMax: 420,
      depthTopValue: 0,
      depthBottomValue: 120,
      unit: 'm',
      depthInterval: 2,
      depthGridEnabled: true,
      isCalibrated: true,
    };

    const yStart = calibration.dataYMin;
    const yEnd = calibration.dataYMax;

    const columns: TaxaColumn[] = [
      {
        id: 'taxa_betula',
        name: 'Betula nana',
        color: '#38bdf8',
        startX: 120,
        endX: 340,
        maxPercent: 60,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(120, 220, yStart, yEnd, [
          0.1, 0.2, 0.4, 0.6, 0.75, 0.8, 0.65, 0.5, 0.35, 0.2,
        ]),
      },
      {
        id: 'taxa_alnus',
        name: 'Alnus viridis',
        color: '#34d399',
        startX: 340,
        endX: 560,
        maxPercent: 50,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(340, 220, yStart, yEnd, [
          0.4, 0.45, 0.5, 0.4, 0.3, 0.25, 0.35, 0.5, 0.6, 0.55,
        ]),
      },
      {
        id: 'taxa_artemisia',
        name: 'Artemisia sp.',
        color: '#fbbf24',
        startX: 560,
        endX: 780,
        maxPercent: 40,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(560, 220, yStart, yEnd, [
          0.7, 0.6, 0.45, 0.3, 0.2, 0.15, 0.1, 0.15, 0.25, 0.4,
        ]),
      },
      {
        id: 'taxa_cyperaceae',
        name: 'Cyperaceae',
        color: '#f472b6',
        startX: 780,
        endX: 1000,
        maxPercent: 40,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(780, 220, yStart, yEnd, [
          0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.65, 0.55, 0.4,
        ]),
      },
    ];

    return {
      imageSrc: './verification_pollen.png',
      imageWidth: 1130,
      imageHeight: 498,
      calibration,
      columns,
      activeTaxaId: 'taxa_betula',
      selectedEntity: null,
    };
  }

  public static getBeginnerDiagramData(): DiagramData {
    const calibration: DiagramCalibration = {
      dataXMin: 220,
      dataXMax: 1750,
      dataYMin: 280,
      dataYMax: 1550,
      depthTopValue: 0,
      depthBottomValue: 300,
      unit: 'cm',
      isCalibrated: true,
      depthInterval: 5,
      depthGridEnabled: true,
    };

    const yStart = calibration.dataYMin;
    const yEnd = calibration.dataYMax;

    const columns: TaxaColumn[] = [
      {
        id: 'taxa_quercus',
        name: 'Quercus robur',
        color: '#38bdf8',
        startX: 220,
        endX: 520,
        maxPercent: 80,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(220, 300, yStart, yEnd, [
          0.8, 0.85, 0.7, 0.6, 0.55, 0.5, 0.65, 0.7, 0.8, 0.75, 0.7,
        ]),
      },
      {
        id: 'taxa_fagus',
        name: 'Fagus sylvatica',
        color: '#34d399',
        startX: 520,
        endX: 820,
        maxPercent: 60,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(520, 300, yStart, yEnd, [
          0.1, 0.15, 0.25, 0.4, 0.55, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15,
        ]),
      },
      {
        id: 'taxa_corylus',
        name: 'Corylus avellana',
        color: '#fbbf24',
        startX: 820,
        endX: 1120,
        maxPercent: 50,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(820, 300, yStart, yEnd, [
          0.3, 0.4, 0.5, 0.45, 0.35, 0.25, 0.2, 0.3, 0.35, 0.4, 0.45,
        ]),
      },
      {
        id: 'taxa_picea',
        name: 'Picea abies',
        color: '#a78bfa',
        startX: 1120,
        endX: 1420,
        maxPercent: 40,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(1120, 300, yStart, yEnd, [
          0.15, 0.2, 0.25, 0.3, 0.4, 0.45, 0.35, 0.25, 0.2, 0.15, 0.1,
        ]),
      },
      {
        id: 'taxa_herbaceous',
        name: 'Total Herbs',
        color: '#fb7185',
        startX: 1420,
        endX: 1720,
        maxPercent: 50,
        tickEndX: 0, unit: '%', isLocked: false, curveType: 'linear',
        visible: true,
        controlPoints: this.generatePoints(1420, 300, yStart, yEnd, [
          0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.2, 0.3, 0.35, 0.4, 0.45,
        ]),
      },
    ];

    return {
      imageSrc: './beginner-tutorial.png',
      imageWidth: 1923,
      imageHeight: 1796,
      calibration,
      columns,
      activeTaxaId: 'taxa_quercus',
      selectedEntity: null,
    };
  }

  public static getSampleDiagram(key: string): DiagramData {
    switch (key) {
      case 'verification':
        return this.getVerificationDiagramData();
      case 'beginner':
        return this.getBeginnerDiagramData();
      case 'hoya':
      default:
        return this.getHoyaDiagramData();
    }
  }

  /**
   * 为用户新上传的图谱生成初始纯净画布数据 (绝对不预先盲目切列和数字化，必须由用户进入 Step 1 框选 ROI)
   */
  public static createInitialSuggestion(
    imageWidth: number,
    imageHeight: number,
    imageSrc: string,
    _diagramName: string = 'User Diagram'
  ): DiagramData {
    const w = Math.max(200, imageWidth);
    const h = Math.max(200, imageHeight);

    const calibration: DiagramCalibration = {
      dataXMin: Math.round(w * 0.12),
      dataXMax: Math.round(w * 0.94),
      dataYMin: Math.round(h * 0.18),
      dataYMax: Math.round(h * 0.88),
      depthTopValue: 0,
      depthBottomValue: 100,
      unit: 'cm',
      isCalibrated: true,
      depthInterval: 2,
      depthGridEnabled: true,
    };

    return {
      imageSrc,
      imageWidth: w,
      imageHeight: h,
      calibration: { ...calibration, isCalibrated: true },
      columns: [],
      activeTaxaId: '',
      selectedEntity: { type: 'roi' },
    };
  }

  /**
   * 当用户在 Step 1 显式确认 ROI 后，在 ROI 数据区内推导初始列分界基线 (此时依然不跑轮廓点)
   */
  public static createColumnsFromRoi(cal: DiagramCalibration): TaxaColumn[] {
    const totalDataWidth = cal.dataXMax - cal.dataXMin;
    const numCols = Math.max(2, Math.min(12, Math.round(totalDataWidth / 140)));
    const colWidth = Math.round(totalDataWidth / numCols);

    const palette = ['#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#fb7185', '#2dd4bf', '#818cf8'];
    const columns: TaxaColumn[] = [];

    for (let i = 0; i < numCols; i++) {
      const startX = cal.dataXMin + i * colWidth;
      const endX = i === numCols - 1 ? cal.dataXMax : startX + colWidth;
      const name = `Taxon ${i + 1}`;
      const color = palette[i % palette.length];

      columns.push({
        id: `taxa_auto_${Date.now()}_${i}`,
        name,
        color,
        startX,
        endX,
        maxPercent: 100,
        tickEndX: endX,
        unit: '%',
        isLocked: false,
        curveType: 'linear',
        visible: true,
        controlPoints: [],
        scale_type: 'linear',
        startValue: 0,
        tickValue: 100,
        plotType: 'area',
      });
    }
    return columns;
  }
}
