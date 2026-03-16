use strict;
use warnings;
use Encode;

my @files = (
    'C:/Users/storm/Downloads/05_找目标用户_怎样吸引真用户而不是假流量_.pdf',
    'C:/Users/storm/Downloads/06_搭选题库1_怎样避免陷入选题枯竭_.pdf',
    'C:/Users/storm/Downloads/07_搭选题库2_怎样让选题持续"自动繁衍"_.pdf',
);

for my $file (@files) {
    print "=== $file ===\n";
    open(my $fh, '<:raw', $file) or do { print "Cannot open: $!\n"; next; };
    local $/;
    my $content = <$fh>;
    close($fh);
    
    # Extract text between parentheses in PDF stream (basic PDF text extraction)
    my @extracted;
    while ($content =~ /\(([^\\\)]{2,})\)\s*Tj/g) {
        my $text = $1;
        # Only print if contains CJK characters or meaningful ASCII
        push @extracted, $text;
    }
    
    if (@extracted) {
        print join("\n", @extracted), "\n";
    } else {
        print "No text extracted with this method\n";
    }
    print "\n";
}
