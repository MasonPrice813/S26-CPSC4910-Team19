<?php
function currentSprint(array $sprintDates): ?int {
    $currentDate = new Datetime('today');

    foreach ($sprintDates as $correctSprint) {
        $startDate = new DateTime($correctSprint['start']);
        $endDate = new DateTime($correctSprint['end']);
        $endDate -> modify('+1 days');

        if ($currentDate >= $startDate && $currentDate <= $endDate) {
            return $correctSprint['num'];
        } 
    }
    
    return null;
}

$sprintDates = [
    [
        'num' => 1, 'start' => '2026-01-27', 'end' => '2026-02-02'
    ],
    [
        'num' => 2, 'start' => '2026-02-03', 'end' => '2026-02-09'
    ],
    [
        'num' => 3, 'start' => '2026-02-10', 'end' => '2026-02-16'
    ],
    [
        'num' => 4, 'start' => '2026-02-17', 'end' => '2026-02-23'
    ],
    [
        'num' => 5, 'start' => '2026-02-24', 'end' => '2026-03-02'
    ],
    [
        'num' => 6, 'start' => '2026-03-03', 'end' => '2026-03-09'
    ],
    [
        'num' => 7, 'start' => '2026-03-10', 'end' => '2026-03-23'
    ],
    [
        'num' => 8, 'start' => '2026-03-24', 'end' => '2026-03-30'
    ],
    [
        'num' => 9, 'start' => '2026-03-31', 'end' => '2026-04-06'
    ],
    [
        'num' => 10, 'start' => '2026-04-07', 'end' => '2026-04-13'
    ]
];

$sprintNum = currentSprint($sprintDates);
