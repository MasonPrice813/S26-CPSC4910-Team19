<?php require 'functions.php';
$sprintNum = currentSprint($sprintDates);
$about_html = file_get_contents('about.html');
$about_html = str_replace('{{SPRINT}}', $sprintNum ?? 'No active sprint', $about_html);

echo $about_html;