PKG=`basename $PWD`
DEST=../build
rm -rf ../build
mkdir -p ../build || exit
for f in *; do
 	if [ "$f" != "node_modules" ] && \
           [ "$f" != "build.sh" ] && \
           [ "$f" != "nodemon.json" ] && \
           [ "$f" != "src" ]
	then 
		cp -rv $f ../build
	fi
done
cd ../build || exit
npm pkg delete devDependencies || exit
cd ../$PKG || exit
tar -zcvf ../$PKG.tar.gz -C ../build . || exit
rm -rf ../build
