#!/bin/bash
echo "SwellDreams Manual Update"
echo "========================"
cd "$(dirname "$0")"
git -c user.email="update@swelldreams.local" -c user.name="SwellDreams" pull origin master
if [ $? -ne 0 ]; then
    echo ""
    echo "Update failed. Try downloading fresh from GitHub:"
    echo "https://github.com/Airegasm/SwellDreams/archive/refs/heads/master.zip"
    exit 1
fi
echo ""
echo "Update complete! Please restart the application."
